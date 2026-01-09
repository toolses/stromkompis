import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Calculator, Zap, TrendingDown, TrendingUp, Info, MapPin, RotateCcw, PlusCircle, Settings, X } from 'lucide-react';
import { HISTORICAL_RATES_2025, HISTORICAL_RATES_2026, type MonthlyRate } from './historicalRates';

// --- TYPER ---

interface MonthlyData {
  month: string;
  consumption: number | ''; 
  surcharge: number | ''; 
}

interface CalculationResultItem {
  month: string;
  consumption: number;
  spotAvg: number;
  subsidyAvg: number;
  userSurcharge: number;
  costNorgespris: number;
  costStromstotte: number;
  savings: number;
}

interface CalculationSummary {
  monthly: CalculationResultItem[];
  totalNorgespris: number;
  totalStromstotte: number;
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

const App: React.FC = () => {
  const NORGESPRIS_ORE = 50; 
  const STROMSTOTTE_TAK_ORE = 96.25; 
  
  // --- STATE ---
  const [selectedZone, setSelectedZone] = useState<string>(() => {
    const savedZone = localStorage.getItem('stromkompis_zone_v3');
    return savedZone || 'NO3';
  });
  
  const [globalSurcharge, setGlobalSurcharge] = useState<number | ''>(() => {
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

    // 2. Hent påslag
    const savedGlobalSurcharge = localStorage.getItem('stromkompis_global_surcharge_v3');
    let loadedGlobalSurcharge: number | '' = 0;
    if (savedGlobalSurcharge) {
      loadedGlobalSurcharge = savedGlobalSurcharge === '' ? '' : Number(savedGlobalSurcharge);
    }

    const savedSurchargesStr = localStorage.getItem('stromkompis_surcharges_v3');
    let loadedSurcharges: (number | '')[] = new Array(12).fill(loadedGlobalSurcharge);
    if (savedSurchargesStr) {
      try {
        const parsed = JSON.parse(savedSurchargesStr);
        if (Array.isArray(parsed) && parsed.length === 12) {
          loadedSurcharges = parsed;
        }
      } catch (e) {
        console.warn("Kunne ikke lese lagrede påslag", e);
      }
    }

    // 3. Konstruer data-tabellen
    return MONTHS.map((month, index) => ({
      month: month,
      consumption: loadedConsumption[index],
      surcharge: loadedSurcharges[index]
    }));
  });
  
  const [isLoaded] = useState<boolean>(true);
  
  const [prefer2026, setPrefer2026] = useState<boolean>(() => {
    const saved = localStorage.getItem('stromkompis_prefer_2026');
    return saved !== null ? saved === 'true' : true;
  });
  
  const [showSettings, setShowSettings] = useState<boolean>(false);
  
  const consumptionRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Lagringseffekt: Kjøres hver gang data endres
  useEffect(() => {
    if (isLoaded && data.length > 0) {
      // Lagre forbruk separat
      const consumptions = data.map(d => d.consumption);
      localStorage.setItem('stromkompis_consumption', JSON.stringify(consumptions));

      // Lagre påslag og innstillinger
      const surcharges = data.map(d => d.surcharge);
      localStorage.setItem('stromkompis_surcharges_v3', JSON.stringify(surcharges));
      localStorage.setItem('stromkompis_zone_v3', selectedZone);
      localStorage.setItem('stromkompis_global_surcharge_v3', globalSurcharge.toString());
      localStorage.setItem('stromkompis_prefer_2026', prefer2026.toString());
    }
  }, [data, selectedZone, globalSurcharge, prefer2026, isLoaded]);

  // --- HANDLERS ---

  const handleZoneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newZone = e.target.value;
    setSelectedZone(newZone);
    // Vi trenger ikke regenerere data-arrayet ved sonebytte lenger, 
    // da vi skiller data (input) fra modell (historicalRates)
  };

  const handleGlobalSurchargeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    const val: number | '' = inputValue === '' ? '' : (isNaN(Number(inputValue)) ? '' : Number(inputValue));
    setGlobalSurcharge(val);
    
    // Overskriv alle måneder med nytt globalt påslag
    const newData: MonthlyData[] = data.map(d => ({
      ...d,
      surcharge: val
    }));
    setData(newData);
  };

  const handleInputChange = (index: number, field: keyof MonthlyData, value: string) => {
    const newData = [...data];
    const numericValue: number | '' = value === '' ? '' : (isNaN(Number(value)) ? '' : Number(value));
    
    if (field === 'consumption' || field === 'surcharge') {
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

  const handleReset = () => {
    if (window.confirm("Dette vil nullstille alle tall, inkludert forbruk. Er du sikker?")) {
      localStorage.removeItem('stromkompis_consumption'); // Sletter også forbruk
      localStorage.removeItem('stromkompis_data_v2'); // Rensk opp gamle versjoner
      localStorage.removeItem('stromkompis_zone_v3');
      localStorage.removeItem('stromkompis_global_surcharge_v3');
      localStorage.removeItem('stromkompis_surcharges_v3');
      localStorage.removeItem('stromkompis_prefer_2026');
      
      // Resett til defaults
      const newData: MonthlyData[] = MONTHS.map((month, index) => ({
        month: month,
        consumption: DEFAULT_CONSUMPTION[index],
        surcharge: 0
      }));
      setData(newData);
      setSelectedZone('NO3');
      setGlobalSurcharge(0);
      setPrefer2026(false);
    }
  };

  // Helper function to get historical rate with fallback logic
  const getHistoricalRate = useCallback((zone: string, month: string): MonthlyRate => {
    // If prefer2026 is enabled, try 2026 first, then fall back to 2025
    if (prefer2026) {
      const rate2026 = HISTORICAL_RATES_2026[zone]?.[month];
      if (rate2026) {
        return rate2026;
      }
    }
    // Default to 2025 (or fallback from 2026)
    return HISTORICAL_RATES_2025[zone]?.[month] || { spotAvg: 0, subsidyAvg: 0 };
  }, [prefer2026]);

  // Helper function to get months that use 2026 data
  const get2026Months = useCallback((zone: string): string[] => {
    const months2026 = HISTORICAL_RATES_2026[zone];
    if (!months2026) return [];
    return Object.keys(months2026);
  }, []);

  // Helper function to format year usage text
  const getYearUsageText = useCallback((): string => {
    if (!prefer2026) {
      return 'Alle måneder bruker 2025-tall';
    }
    
    const months2026 = get2026Months(selectedZone);
    if (months2026.length === 0) {
      return 'Alle måneder bruker 2025-tall (ingen 2026-data tilgjengelig)';
    }
    
    // Convert month abbreviations to full names
    const monthNames2026 = months2026.map(month => MONTH_NAMES[month] || month);
    
    if (months2026.length === 1) {
      return `For ${monthNames2026[0]} brukes 2026-tall, resten bruker 2025-tall`;
    }
    
    if (months2026.length === MONTHS.length) {
      return 'Alle måneder bruker 2026-tall';
    }
    
    // Multiple months - format nicely
    const monthNamesText = monthNames2026.join(', ');
    return `For ${monthNamesText} brukes 2026-tall, resten bruker 2025-tall`;
  }, [prefer2026, selectedZone, get2026Months]);

  // --- KALKULERINGER ---
  const results: CalculationSummary = useMemo(() => {
    const monthlyResults = data.map((item) => {
      const consumption = Number(item.consumption);
      const userSurcharge = Number(item.surcharge);
      
      // Hent historiske data med fallback-logikk
      const historicalData = getHistoricalRate(selectedZone, item.month);
      const { spotAvg, subsidyAvg } = historicalData;

      // 1. Norgespris (50 øre fast)
      const costNorgespris = (consumption * NORGESPRIS_ORE) / 100;

      // 2. Strømstøtte-scenario
      const effectivePricePerKwh = (spotAvg + userSurcharge) - subsidyAvg;
      const costStromstotte = (consumption * effectivePricePerKwh) / 100;

      const savings = costStromstotte - costNorgespris;

      return {
        month: item.month,
        consumption,
        spotAvg,
        subsidyAvg,
        userSurcharge,
        costNorgespris,
        costStromstotte,
        savings
      } as CalculationResultItem;
    });

    const totals = monthlyResults.reduce(
      (acc, item) => ({
        totalNorgespris: acc.totalNorgespris + item.costNorgespris,
        totalStromstotte: acc.totalStromstotte + item.costStromstotte,
      }),
      { totalNorgespris: 0, totalStromstotte: 0 }
    );

    return {
      monthly: monthlyResults,
      totalNorgespris: totals.totalNorgespris,
      totalStromstotte: totals.totalStromstotte,
      totalDifference: totals.totalStromstotte - totals.totalNorgespris
    };
  }, [data, selectedZone, getHistoricalRate]);

  if (!isLoaded) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col lg:flex-row justify-between items-center gap-6 border-b border-slate-200 pb-6">
          <div className="text-center lg:text-left">
            <div className="flex justify-center lg:justify-start items-center gap-3 text-blue-600 mb-2">
              <Zap size={32} fill="currentColor" />
              <h1 className="text-3xl font-bold tracking-tight">Strømkompis</h1>
            </div>
            <p className="text-slate-500">
              Sammenlign "Strømstøtte" mot "Norgespris"
            </p>          
          </div>

          <div className="flex flex-wrap justify-center items-end gap-4 bg-white p-4 rounded-lg shadow-sm border border-slate-200">
             
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

             {/* Påslag input */}
             <div className="flex flex-col">
                <label className="text-xs text-slate-400 font-semibold uppercase mb-1 flex items-center gap-1">
                  <PlusCircle size={12} /> Globalt Påslag
                </label>
                <input 
                  type="number"
                  value={globalSurcharge}
                  onChange={handleGlobalSurchargeChange}
                  className="bg-slate-50 border border-slate-300 text-slate-800 text-sm rounded focus:ring-blue-500 focus:border-blue-500 block w-24 p-2"
                  placeholder="0"
                />
             </div>

             <div className="border-l border-slate-200 pl-4 ml-2 h-10 flex items-center gap-2">
               <button 
                  onClick={() => setShowSettings(true)}
                  className="text-slate-400 hover:text-blue-500 p-2 rounded-full hover:bg-slate-50 transition-colors"
                  title="Innstillinger"
                >
                  <Settings size={20} />
               </button>
               <button 
                  onClick={handleReset}
                  className="hidden text-slate-400 hover:text-red-500 p-2 rounded-full hover:bg-slate-50 transition-colors"
                  title="Tilbakestill alt"
                >
                  <RotateCcw size={20} />
               </button>
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
                  <th className="px-4 py-3">Påslag</th>
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

                    {/* Påslag Input */}
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        className={`w-full max-w-[100px] px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow ${
                          data[index].surcharge !== globalSurcharge 
                            ? 'bg-yellow-50 border-yellow-300' 
                            : 'bg-white border-slate-300'
                        }`}
                        title={data[index].surcharge !== globalSurcharge ? "Manuelt endret fra globalt påslag" : "Følger globalt påslag"}
                        value={data[index].surcharge}
                        onChange={(e) => handleInputChange(index, 'surcharge', e.target.value)}
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
              <p className="text-xs text-slate-400 mb-4">Spot + Påslag - Støtte (Tak: {STROMSTOTTE_TAK_ORE} øre/kWh)</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-slate-800">{Math.round(results.totalStromstotte).toLocaleString()} kr</p>
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
                  <label className="flex items-center justify-between cursor-pointer">
                    <div className="flex-1">
                      <div className="font-semibold text-slate-800 mb-1">Bruk 2026-data hvor tilgjengelig</div>
                      <div className="text-sm text-slate-500">
                        Når aktivert, brukes 2026-data for måneder hvor det finnes, ellers falles det tilbake til 2025-data.
                        {prefer2026 && (
                          <span className="block mt-1 text-blue-600">
                            Aktuelt: {getYearUsageText()}.
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ml-4">
                      <input
                        type="checkbox"
                        checked={prefer2026}
                        onChange={(e) => setPrefer2026(e.target.checked)}
                        className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                      />
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
          <p>Snitt spotpris inkluderer MVA (unntatt NO4). Strømstøtte er beregnet time for time basert på faktiske priser {prefer2026 ? 'i 2026 hvor tilgjengelig, ellers 2025' : 'i 2025'}.</p>
          <p>Strømpriser levert av <a href="https://www.hvakosterstrommen.no" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline">Hva koster strømmen.no</a></p>
          <p className="pt-4">© 2026 toolses</p>
        </div>

      </div>
    </div>
  );
};

export default App;