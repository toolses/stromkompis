import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Calculator, Zap, TrendingDown, TrendingUp, Info, MapPin, PlusCircle, Settings, X } from 'lucide-react';
import { AVAILABLE_YEARS, LATEST_TIMESTAMP, type MonthlyRate } from './historicalRates';
// Import individual year rates for backward compatibility and fallback
import * as historicalRatesModule from './historicalRates';

type HistoricalRatesByYear = Record<number, Record<string, Record<string, MonthlyRate>>>;

// Create HISTORICAL_RATES_BY_YEAR from available exports or use fallback
const getHistoricalRatesByYear = (): HistoricalRatesByYear => {
  // Check if HISTORICAL_RATES_BY_YEAR is exported (new format)
  if ('HISTORICAL_RATES_BY_YEAR' in historicalRatesModule) {
    return (historicalRatesModule as typeof historicalRatesModule & { HISTORICAL_RATES_BY_YEAR: HistoricalRatesByYear }).HISTORICAL_RATES_BY_YEAR;
  }
  
  // Fallback: Build from individual year exports (old format)
  const ratesByYear: HistoricalRatesByYear = {};
  for (const year of AVAILABLE_YEARS) {
    const yearKey = `HISTORICAL_RATES_${year}` as keyof typeof historicalRatesModule;
    const yearData = historicalRatesModule[yearKey];
    if (yearData && typeof yearData === 'object') {
      ratesByYear[year] = yearData as Record<string, Record<string, MonthlyRate>>;
    }
  }
  return ratesByYear;
};

const HISTORICAL_RATES_BY_YEAR = getHistoricalRatesByYear();

// --- TYPER ---

interface MonthlyData {
  month: string;
  consumption: number | ''; 
  marketAdjustment: number | ''; 
}

interface CalculationResultItem {
  month: string;
  consumption: number;
  spotAvg: number;
  subsidyAvg: number;
  marketAdjustment: number;
  newSubsidy: number;
  costNorgespris: number;
  costStromstotte: number;
  savings: number;
}

interface CalculationSummary {
  monthly: CalculationResultItem[];
  totalNorgespris: number;
  totalStromstotte: number;
  totalSubsidy: number;
  totalDifference: number;
}

// --- DATA ---

const ZONE_NAMES: Record<string, string> = {
  NO1: 'NO1 (Østlandet)',
  NO2: 'NO2 (Sørlandet)',
  NO3: 'NO3 (Midt-Norge)',
  NO4: 'NO4 (Nord-Norge)',
  NO5: 'NO5 (Vestlandet)',
};

const MONTHS: string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];

const MONTH_NAMES: Record<string, string> = {
  'Jan': 'januar',
  'Feb': 'februar',
  'Mar': 'mars',
  'Apr': 'april',
  'Mai': 'mai',
  'Jun': 'juni',
  'Jul': 'juli',
  'Aug': 'august',
  'Sep': 'september',
  'Okt': 'oktober',
  'Nov': 'november',
  'Des': 'desember'
};

const DEFAULT_CONSUMPTION: number[] = [1781, 1502, 1452, 1110, 1294, 948, 1024, 1118, 1138, 1415, 1609, 1801];

// Helper function to get subsidy threshold based on zone
const getSubsidyThreshold = (zone: string): number => {
  // Base threshold for 2026: 77 øre/kWh excl. VAT
  // NO4 is VAT-exempt, others have 25% VAT
  return zone === 'NO4' ? 77 : 96.25; // 77 * 1.25 = 96.25
};

// Calculate theoretical subsidy for a given spot price
const calculateTheoreticalSubsidy = (spotPrice: number, zone: string): number => {
  const threshold = getSubsidyThreshold(zone);
  // Subsidy = 90% of amount above threshold
  return Math.max(0, (spotPrice - threshold) * 0.90);
};

const App: React.FC = () => {
  const NORGESPRIS_ORE = 50; 
  
  // --- STATE ---
  const [selectedZone, setSelectedZone] = useState<string>(() => {
    const savedZone = localStorage.getItem('stromkompis_zone_v3');
    return savedZone || 'NO3';
  });
  
  const [globalMarketAdjustment, setGlobalMarketAdjustment] = useState<number | ''>(() => {
    const savedGlobalMarketAdjustment = localStorage.getItem('stromkompis_global_market_adjustment_v3');
    if (savedGlobalMarketAdjustment) {
      return savedGlobalMarketAdjustment === '' ? '' : Number(savedGlobalMarketAdjustment);
    }
    // Try to migrate from old key
    const savedGlobalSurcharge = localStorage.getItem('stromkompis_global_surcharge_v3');
    if (savedGlobalSurcharge) {
      return savedGlobalSurcharge === '' ? '' : Number(savedGlobalSurcharge);
    }
    return 0;
  }); 
  
  const [data, setData] = useState<MonthlyData[]>(() => {
    // 1. Hent forbruk
    const savedConsumptionStr = localStorage.getItem('stromkompis_consumption');
    let loadedConsumption: (number | '')[] = [...DEFAULT_CONSUMPTION];
    
    if (savedConsumptionStr) {
      try {
        const parsed = JSON.parse(savedConsumptionStr);
        if (Array.isArray(parsed) && parsed.length === 12) {
          loadedConsumption = parsed;
        }
      } catch (e) {
        console.warn("Kunne ikke lese lagret forbruk", e);
      }
    }

    // 2. Hent markedsjustering
    const savedGlobalMarketAdjustment = localStorage.getItem('stromkompis_global_market_adjustment_v3');
    let loadedGlobalMarketAdjustment: number | '' = 0;
    if (savedGlobalMarketAdjustment) {
      loadedGlobalMarketAdjustment = savedGlobalMarketAdjustment === '' ? '' : Number(savedGlobalMarketAdjustment);
    } else {
      // Try to migrate from old key
      const savedGlobalSurcharge = localStorage.getItem('stromkompis_global_surcharge_v3');
      if (savedGlobalSurcharge) {
        loadedGlobalMarketAdjustment = savedGlobalSurcharge === '' ? '' : Number(savedGlobalSurcharge);
      }
    }

    const savedMarketAdjustmentsStr = localStorage.getItem('stromkompis_market_adjustments_v3');
    let loadedMarketAdjustments: (number | '')[] = new Array(12).fill(loadedGlobalMarketAdjustment);
    if (savedMarketAdjustmentsStr) {
      try {
        const parsed = JSON.parse(savedMarketAdjustmentsStr);
        if (Array.isArray(parsed) && parsed.length === 12) {
          loadedMarketAdjustments = parsed;
        }
      } catch (e) {
        console.warn("Kunne ikke lese lagrede markedsjusteringer", e);
      }
    } else {
      // Try to migrate from old key
      const savedSurchargesStr = localStorage.getItem('stromkompis_surcharges_v3');
      if (savedSurchargesStr) {
        try {
          const parsed = JSON.parse(savedSurchargesStr);
          if (Array.isArray(parsed) && parsed.length === 12) {
            loadedMarketAdjustments = parsed;
          }
        } catch (e) {
          console.warn("Kunne ikke lese lagrede markedsjusteringer fra gammel nøkkel", e);
        }
      }
    }

    // 3. Konstruer data-tabellen
    return MONTHS.map((month, index) => ({
      month: month,
      consumption: loadedConsumption[index],
      marketAdjustment: loadedMarketAdjustments[index]
    }));
  });
  
  const [isLoaded] = useState<boolean>(true);
  
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const saved = localStorage.getItem('stromkompis_selected_year');
    if (saved) {
      const year = Number(saved);
      if (AVAILABLE_YEARS.includes(year)) {
        return year;
      }
    }
    // Migrer fra gammel prefer2026 nøkkel
    const oldPrefer2026 = localStorage.getItem('stromkompis_prefer_2026');
    if (oldPrefer2026 === 'true' && AVAILABLE_YEARS.includes(2026)) {
      return 2026;
    }
    // Default til det høyeste tilgjengelige året
    return AVAILABLE_YEARS.length > 0 ? Math.max(...AVAILABLE_YEARS) : 2025;
  });
  
  const [showSettings, setShowSettings] = useState<boolean>(false);
  
  const consumptionRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Lagringseffekt: Kjøres hver gang data endres
  useEffect(() => {
    if (isLoaded && data.length > 0) {
      // Lagre forbruk separat
      const consumptions = data.map(d => d.consumption);
      localStorage.setItem('stromkompis_consumption', JSON.stringify(consumptions));

      // Lagre markedsjustering og innstillinger
      const marketAdjustments = data.map(d => d.marketAdjustment);
      localStorage.setItem('stromkompis_market_adjustments_v3', JSON.stringify(marketAdjustments));
      localStorage.setItem('stromkompis_zone_v3', selectedZone);
      localStorage.setItem('stromkompis_global_market_adjustment_v3', globalMarketAdjustment.toString());
      localStorage.setItem('stromkompis_selected_year', selectedYear.toString());
    }
  }, [data, selectedZone, globalMarketAdjustment, selectedYear, isLoaded]);

  // --- HANDLERS ---

  const handleZoneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newZone = e.target.value;
    setSelectedZone(newZone);
    // Vi trenger ikke regenerere data-arrayet ved sonebytte lenger, 
    // da vi skiller data (input) fra modell (historicalRates)
  };

  const handleGlobalMarketAdjustmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    const val: number | '' = inputValue === '' ? '' : (isNaN(Number(inputValue)) ? '' : Number(inputValue));
    setGlobalMarketAdjustment(val);
    
    // Overskriv alle måneder med nytt global markedsjustering
    const newData: MonthlyData[] = data.map(d => ({
      ...d,
      marketAdjustment: val
    }));
    setData(newData);
  };

  const handleInputChange = (index: number, field: keyof MonthlyData, value: string) => {
    const newData = [...data];
    const numericValue: number | '' = value === '' ? '' : (isNaN(Number(value)) ? '' : Number(value));
    
    if (field === 'consumption' || field === 'marketAdjustment') {
      newData[index][field] = numericValue;
    }
    setData(newData);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (index + 1 < consumptionRefs.current.length) {
        consumptionRefs.current[index + 1]?.focus();
      }
    }
  };


  // Helper function to get historical rate with fallback logic
  const getHistoricalRate = useCallback((zone: string, month: string): MonthlyRate => {
    // Prøv først valgt år
    const selectedYearData = HISTORICAL_RATES_BY_YEAR[selectedYear];
    if (selectedYearData?.[zone]?.[month]) {
      return selectedYearData[zone][month];
    }
    
    // Hvis valgt år er inneværende år og data mangler, fall tilbake til forrige år
    const currentYear = new Date().getFullYear();
    if (selectedYear === currentYear) {
      // Finn forrige tilgjengelige år
      const previousYears = AVAILABLE_YEARS.filter(y => y < selectedYear).sort((a, b) => b - a);
      for (const prevYear of previousYears) {
        const prevYearData = HISTORICAL_RATES_BY_YEAR[prevYear];
        if (prevYearData?.[zone]?.[month]) {
          return prevYearData[zone][month];
        }
      }
    }
    
    // Fallback til tom data hvis ingenting funnet
    return { spotAvg: 0, subsidyAvg: 0 };
  }, [selectedYear]);

  // Helper function to get months that use selected year data
  const getSelectedYearMonths = useCallback((zone: string, year: number): string[] => {
    const yearData = HISTORICAL_RATES_BY_YEAR[year];
    if (!yearData?.[zone]) return [];
    return Object.keys(yearData[zone]);
  }, []);

  // Helper function to get months that use fallback year data
  const getFallbackYearMonths = useCallback((zone: string, currentSelectedYear: number): string[] => {
    const currentYear = new Date().getFullYear();
    if (currentSelectedYear !== currentYear) return [];
    
    const previousYears = AVAILABLE_YEARS.filter(y => y < currentSelectedYear).sort((a, b) => b - a);
    if (previousYears.length === 0) return [];
    
    const selectedYearMonths = getSelectedYearMonths(zone, currentSelectedYear);
    const allMonths = new Set(MONTHS);
    selectedYearMonths.forEach(m => allMonths.delete(m));
    
    return Array.from(allMonths);
  }, [getSelectedYearMonths]);

  // Helper function to check if selected year is current year
  const isCurrentYear = useCallback((year: number): boolean => {
    return year === new Date().getFullYear();
  }, []);

  // Helper function to check if selected year data is complete
  const isYearDataComplete = useCallback((zone: string, year: number): boolean => {
    const yearData = HISTORICAL_RATES_BY_YEAR[year];
    if (!yearData?.[zone]) return false;
    return Object.keys(yearData[zone]).length === MONTHS.length;
  }, []);

  // Helper function to format year usage text
  const getYearUsageText = useCallback((): string => {
    const currentSelectedYear = selectedYear;
    const selectedYearMonths = getSelectedYearMonths(selectedZone, currentSelectedYear);
    const fallbackMonths = getFallbackYearMonths(selectedZone, currentSelectedYear);
    
    if (selectedYearMonths.length === 0) {
      // Ingen data for valgt år, bruk forrige år
      const previousYears = AVAILABLE_YEARS.filter(y => y < currentSelectedYear).sort((a, b) => b - a);
      if (previousYears.length > 0) {
        return `Alle måneder bruker ${previousYears[0]}-tall (ingen ${currentSelectedYear}-data tilgjengelig)`;
      }
      return `Ingen data tilgjengelig for ${currentSelectedYear}`;
    }
    
    if (selectedYearMonths.length === MONTHS.length) {
      // Alle måneder har data for valgt år
      if (isCurrentYear(currentSelectedYear) && !isYearDataComplete(selectedZone, currentSelectedYear)) {
        // Dette bør ikke skje, men håndter det
        return `Alle måneder bruker ${currentSelectedYear}-tall`;
      }
      return `Alle måneder bruker ${currentSelectedYear}-tall`;
    }
    
    // Noen måneder mangler - vis hvilke som bruker valgt år og hvilke som bruker fallback
    const monthNamesSelected = selectedYearMonths.map(month => MONTH_NAMES[month] || month);
    const monthNamesFallback = fallbackMonths.map(month => MONTH_NAMES[month] || month);
    
    if (fallbackMonths.length > 0) {
      const previousYears = AVAILABLE_YEARS.filter(y => y < currentSelectedYear).sort((a, b) => b - a);
      const fallbackYear = previousYears[0];
      
      if (selectedYearMonths.length === 1) {
        return `For ${monthNamesSelected[0]} brukes ${currentSelectedYear}-tall, resten bruker ${fallbackYear}-tall`;
      }
      
      const selectedText = monthNamesSelected.join(', ');
      const fallbackText = monthNamesFallback.join(', ');
      return `For ${selectedText} brukes ${currentSelectedYear}-tall, for ${fallbackText} brukes ${fallbackYear}-tall`;
    }
    
    // Fallback måneder ikke funnet, men noen måneder mangler
    if (selectedYearMonths.length === 1) {
      return `For ${monthNamesSelected[0]} brukes ${currentSelectedYear}-tall, resten mangler data`;
    }
    
    const selectedText = monthNamesSelected.join(', ');
    return `For ${selectedText} brukes ${currentSelectedYear}-tall, resten mangler data`;
  }, [selectedYear, selectedZone, getSelectedYearMonths, getFallbackYearMonths, isCurrentYear, isYearDataComplete]);

  // Helper function to format LATEST_TIMESTAMP for display
  const formatLatestTimestamp = useCallback((): string => {
    try {
      const date = new Date(LATEST_TIMESTAMP);
      const day = date.getDate();
      const month = MONTH_NAMES[MONTHS[date.getMonth()]] || date.toLocaleDateString('nb-NO', { month: 'long' });
      const year = date.getFullYear();
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${day}. ${month} ${year} kl. ${hours}:${minutes}`;
    } catch {
      return LATEST_TIMESTAMP;
    }
  }, []);

  // --- KALKULERINGER ---
  const results: CalculationSummary = useMemo(() => {
    const monthlyResults = data.map((item) => {
      const consumption = Number(item.consumption);
      const marketAdjustment = Number(item.marketAdjustment);
      
      // Hent historiske data med fallback-logikk
      const historicalData = getHistoricalRate(selectedZone, item.month);
      const { spotAvg, subsidyAvg } = historicalData;

      // 1. Norgespris (50 øre fast)
      const costNorgespris = (consumption * NORGESPRIS_ORE) / 100;

      // 2. Strømstøtte-scenario med hybrid modell
      // Calculate new spot price with market adjustment
      const nySpot = spotAvg + marketAdjustment;
      
      // Calculate theoretical subsidies
      const theoreticalSubsidyHistorisk = calculateTheoreticalSubsidy(spotAvg, selectedZone);
      const theoreticalSubsidyNy = calculateTheoreticalSubsidy(nySpot, selectedZone);
      
      // Hybrid model: adjust actual subsidy by the difference in theoretical subsidies
      const newSubsidy = subsidyAvg + (theoreticalSubsidyNy - theoreticalSubsidyHistorisk);
      
      // Final effective price
      const effectivePricePerKwh = nySpot - newSubsidy;
      const costStromstotte = (consumption * effectivePricePerKwh) / 100;

      const savings = costStromstotte - costNorgespris;

      return {
        month: item.month,
        consumption,
        spotAvg,
        subsidyAvg,
        marketAdjustment,
        newSubsidy,
        costNorgespris,
        costStromstotte,
        savings
      } as CalculationResultItem;
    });

    const totals = monthlyResults.reduce(
      (acc, item) => ({
        totalNorgespris: acc.totalNorgespris + item.costNorgespris,
        totalStromstotte: acc.totalStromstotte + item.costStromstotte,
        totalSubsidy: acc.totalSubsidy + (item.newSubsidy * item.consumption / 100),
      }),
      { totalNorgespris: 0, totalStromstotte: 0, totalSubsidy: 0 }
    );

    return {
      monthly: monthlyResults,
      totalNorgespris: totals.totalNorgespris,
      totalStromstotte: totals.totalStromstotte,
      totalSubsidy: totals.totalSubsidy,
      totalDifference: totals.totalStromstotte - totals.totalNorgespris
    };
  }, [data, selectedZone, getHistoricalRate]);

  if (!isLoaded) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col lg:flex-row justify-between items-center gap-6 border-b border-slate-200 pb-6">
          <div className="text-center lg:text-left w-full lg:w-auto">
            <div className="flex justify-center lg:justify-start items-center gap-3 text-blue-600 mb-2">
              <Zap size={32} fill="currentColor" />
              <h1 className="text-3xl font-bold tracking-tight">Strømkompis</h1>
              <button 
                onClick={() => setShowSettings(true)}
                className="ml-auto lg:ml-2 text-slate-400 hover:text-blue-500 p-2 rounded-full hover:bg-slate-50 transition-colors"
                title="Innstillinger"
              >
                <Settings size={20} />
              </button>
            </div>
            <p className="text-slate-500">
              Sammenlign "Strømstøtte" mot "Norgespris"
            </p>          
          </div>

          <div className="flex flex-wrap justify-center items-end gap-4 bg-white p-4 rounded-lg shadow-sm border border-slate-200 w-full lg:w-auto">
             
             {/* Sonevelger */}
             <div className="flex flex-col">
                <label className="text-xs text-slate-400 font-semibold uppercase mb-1 flex items-center gap-1">
                  <MapPin size={12} /> Prissone
                </label>
                <select 
                  value={selectedZone} 
                  onChange={handleZoneChange}
                  className="bg-slate-50 border border-slate-300 text-slate-800 text-sm rounded focus:ring-blue-500 focus:border-blue-500 block w-40 p-2"
                >
                  {Object.keys(ZONE_NAMES).map((key) => (
                    <option key={key} value={key}>{ZONE_NAMES[key]}</option>
                  ))}
                </select>
             </div>

             {/* Markedsjustering input */}
             <div className="flex flex-col">
                <label className="text-xs text-slate-400 font-semibold uppercase mb-1 flex items-center gap-1">
                  <PlusCircle size={12} /> Global Markedsjustering
                </label>
                <input 
                  type="number"
                  value={globalMarketAdjustment}
                  onChange={handleGlobalMarketAdjustmentChange}
                  className="bg-slate-50 border border-slate-300 text-slate-800 text-sm rounded focus:ring-blue-500 focus:border-blue-500 block w-full min-w-[180px] p-2"
                  placeholder="0"
                />
             </div>
          </div>
        </header>

        {/* Input Seksjon */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 bg-slate-100 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Calculator className="w-5 h-5" /> Månedlige tall
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Spotpris og strømstøtte hentes fra historiske data.
                <br/>
                <span className="text-xs text-slate-400">
                  {getYearUsageText()}. Dette kan endres under innstillinger.
                </span>
              </p>
            </div>
            <div className="text-sm bg-blue-50 text-blue-700 px-3 py-1 rounded-full border border-blue-100 flex items-center gap-1">
              <Info className="w-4 h-4" /> Alle priser er i øre/kWh
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-3">Måned</th>
                  <th className="px-4 py-3">Forbruk (kWh)</th>
                  <th className="px-4 py-3 text-slate-400 font-normal">Snitt Spot</th>
                  <th className="px-4 py-3 text-slate-400 font-normal">Snitt Støtte</th>
                  <th className="px-4 py-3">Markedsjustering</th>
                </tr>
              </thead>
              <tbody>
                {results.monthly.map((row, index) => (
                  <tr key={row.month} className="border-b hover:bg-slate-50 transition-colors group">
                    <td className="px-4 py-3 font-medium bg-slate-50 group-hover:bg-slate-100 w-24">{row.month}</td>
                    
                    {/* Forbruk Input */}
                    <td className="px-4 py-2">
                      <input
                        ref={(el) => { consumptionRefs.current[index] = el; }}
                        type="number"
                        min="0"
                        className="w-full max-w-[120px] px-3 py-2 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                        value={data[index].consumption}
                        onChange={(e) => handleInputChange(index, 'consumption', e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, index)}
                      />
                    </td>

                    {/* Info kolonner (Read only) */}
                    <td className="px-4 py-2 text-slate-500">
                      {row.spotAvg.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-green-600">
                      -{row.subsidyAvg.toFixed(2)}
                    </td>

                    {/* Markedsjustering Input */}
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        className={`w-full max-w-[100px] px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow ${
                          data[index].marketAdjustment !== globalMarketAdjustment 
                            ? 'bg-yellow-50 border-yellow-300' 
                            : 'bg-white border-slate-300'
                        }`}
                        title={data[index].marketAdjustment !== globalMarketAdjustment ? "Manuelt endret fra global markedsjustering" : "Følger global markedsjustering"}
                        value={data[index].marketAdjustment}
                        onChange={(e) => handleInputChange(index, 'marketAdjustment', e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Resultat Oppsummering */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
            <div>
              <h3 className="text-slate-500 font-medium mb-1">Dagens ordning (Strømstøtte)</h3>
              <p className="text-xs text-slate-400 mb-4">Spot + Markedsjustering - Støtte (Tak: {getSubsidyThreshold(selectedZone)} øre/kWh)</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-slate-800">{Math.round(results.totalStromstotte).toLocaleString()} kr</p>
              <p className="text-sm text-green-600 mt-2">Strømstøtte: {Math.round(results.totalSubsidy).toLocaleString()} kr</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
            <div>
              <h3 className="text-slate-500 font-medium mb-1">Norgespris</h3>
              <p className="text-xs text-slate-400 mb-4">Fast 50 øre/kWh</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-blue-600">{Math.round(results.totalNorgespris).toLocaleString()} kr</p>
            </div>
          </div>

          <div className={`p-6 rounded-xl shadow-sm border flex flex-col justify-between ${results.totalDifference > 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <div>
              <h3 className={`${results.totalDifference > 0 ? 'text-green-800' : 'text-red-800'} font-medium mb-1`}>
                {results.totalDifference > 0 ? 'Du SPARER på Norgespris' : 'Du TAPER på Norgespris'}
              </h3>
            </div>
            
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-2">
                {results.totalDifference > 0 ? <TrendingUp className="text-green-600 w-8 h-8" /> : <TrendingDown className="text-red-600 w-8 h-8" />}
                <p className={`text-4xl font-bold ${results.totalDifference > 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {Math.abs(Math.round(results.totalDifference)).toLocaleString()} kr
                </p>
              </div>
              <p className={`text-sm ${results.totalDifference > 0 ? 'text-green-600' : 'text-red-600'}`}>
                Total differanse per år
              </p>
            </div>
          </div>
        </div>

        {/* Grafer */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Månedlig kostnad */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-lg font-semibold mb-6">Månedlig Kostnad (NOK)</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={results.monthly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                  <Tooltip 
                    formatter={(value: number | undefined) => `${Math.round(value ?? 0)} kr`}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    cursor={{fill: '#f1f5f9'}}
                  />
                  <Legend />
                  <Bar dataKey="costStromstotte" name="Strømstøtte" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="costNorgespris" name="Norgespris" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Akkumulert Sparing */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-lg font-semibold mb-6">Månedlig Differanse (+ = Spart)</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={results.monthly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                  <Tooltip 
                    formatter={(value: number | undefined) => `${Math.round(value ?? 0)} kr`}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="savings" 
                    name="Besparelse med Norgespris" 
                    stroke={results.totalDifference > 0 ? "#16a34a" : "#dc2626"}
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#fff', strokeWidth: 2 }}
                    activeDot={{ r: 8 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Settings Modal */}
        {showSettings && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowSettings(false)}>
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                  <Settings className="w-6 h-6" />
                  Innstillinger
                </h2>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"
                  title="Lukk"
                >
                  <X size={24} />
                </button>
              </div>
              
              <div className="space-y-6">
                <div className="border border-slate-200 rounded-lg p-4">
                  <label className="flex flex-col gap-2">
                    <div className="font-semibold text-slate-800">Velg prisår</div>
                    <div className="text-sm text-slate-500 mb-2">
                      Velg hvilket år sine priser som skal brukes. For inneværende år vil måneder uten data automatisk bruke forrige års tall.
                    </div>
                    <select
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(Number(e.target.value))}
                      className="bg-slate-50 border border-slate-300 text-slate-800 text-sm rounded focus:ring-blue-500 focus:border-blue-500 block w-full p-2"
                    >
                      {AVAILABLE_YEARS.map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                    <div className="text-sm text-slate-500 mt-2">                     
                      <span className="block mt-1 text-slate-400 text-xs">
                        Data hentet frem til {formatLatestTimestamp()}.
                      </span>
                      {isCurrentYear(selectedYear) && !isYearDataComplete(selectedZone, selectedYear) && (
                        <span className="block mt-1 text-amber-600 text-xs font-medium">
                          ⚠️ {selectedYear}-tallene er ikke komplette. Måneder uten data bruker {AVAILABLE_YEARS.filter(y => y < selectedYear).sort((a, b) => b - a)[0]}-tall.
                        </span>
                      )}
                    </div>
                  </label>
                </div>
              </div>
              
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Lukk
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Fotnote */}
        <div className="text-center text-slate-400 text-sm pb-8 space-y-2">
          <p>NB: Utregningene inkluderer ikke nettleie eller faste avgifter, kun energileddet.</p>
          <p>Snitt spotpris inkluderer MVA (unntatt NO4). Gjennomsnittlig strømstøtte er beregnet time for time basert på faktiske priser.</p>
          {isCurrentYear(selectedYear) && !isYearDataComplete(selectedZone, selectedYear) && (
            <p className="text-amber-600 font-medium">
              ⚠️ Merk: {selectedYear}-tallene er ikke komplette (det er {new Date().toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })}). 
              Måneder uten {selectedYear}-data bruker {AVAILABLE_YEARS.filter(y => y < selectedYear).sort((a, b) => b - a)[0]}-tall.
            </p>
          )}
          <p>Strømpriser levert av <a href="https://www.hvakosterstrommen.no" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline">Hva koster strømmen.no</a></p>
          <p className="pt-4">© {new Date().getFullYear()} toolses</p>
        </div>

      </div>
    </div>
  );
};

export default App;