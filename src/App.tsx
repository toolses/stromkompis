import React, { useState, useMemo, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Calculator, Zap, TrendingDown, TrendingUp, Info, MapPin, RotateCcw, PlusCircle } from 'lucide-react';

// --- TYPER ---

interface PriceZoneData {
  name: string;
  prices: number[];
}

interface PriceZones {
  [key: string]: PriceZoneData;
}

interface MonthlyData {
  month: string;
  // Endret til number | '' for å tillate at brukeren visker ut feltet helt
  consumption: number | ''; 
  spotPrice: number | '';
}

interface CalculationResultItem {
  month: string;
  consumption: number;
  spotPrice: number;
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

const PRICE_ZONES: PriceZones = {
  NO1: { // Øst
    name: 'NO1 (Østlandet)',
    prices: [94, 121, 65, 75, 89, 67, 62, 91, 75, 74, 116, 102]
  },
  NO2: { // Sør
    name: 'NO2 (Sørlandet)',
    prices: [97, 126, 71, 82, 93, 80, 103, 105, 88, 87, 118, 103]
  },
  NO3: { // Midt
    name: 'NO3 (Midt-Norge)',
    prices: [35, 43, 25, 21, 16, 16, 9, 10, 22, 36, 68, 73]
  },
  NO4: { // Nord
    name: 'NO4 (Nord-Norge)',
    prices: [11, 8, 6, 2, 8, 4, 3, 3, 5, 5, 36, 32]
  },
  NO5: { // Vest
    name: 'NO5 (Vestlandet)',
    prices: [78, 106, 58, 56, 63, 52, 22, 46, 69, 70, 111, 98]
  }
};

const MONTHS: string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];

const DEFAULT_CONSUMPTION: number[] = [2200, 1900, 1600, 1100, 800, 500, 400, 450, 700, 1000, 1500, 2000];

const App: React.FC = () => {
  const NORGESPRIS_ORE = 50; 
  const STROMSTOTTE_TAK_ORE = 96.25;

  // --- STATE ---
  const [selectedZone, setSelectedZone] = useState<string>('NO3');
  const [surcharge, setSurcharge] = useState<number | ''>(0); 
  const [data, setData] = useState<MonthlyData[]>([]);
  const [isLoaded, setIsLoaded] = useState<boolean>(false); 
  
  // Refs for å håndtere fokus-bytte på Enter
  const consumptionRefs = useRef<(HTMLInputElement | null)[]>([]);

  // --- INITIALISERING / LOCALSTORAGE ---

  useEffect(() => {
    const savedData = localStorage.getItem('stromkompis_data_2025');
    const savedZone = localStorage.getItem('stromkompis_zone_2025');
    const savedSurcharge = localStorage.getItem('stromkompis_surcharge_2025');

    if (savedData && savedZone) {
      setData(JSON.parse(savedData));
      setSelectedZone(savedZone);
      if (savedSurcharge) setSurcharge(savedSurcharge === '' ? '' : Number(savedSurcharge));
    } else {
      generateDataForZone('NO3', false, 0);
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoaded && data.length > 0) {
      localStorage.setItem('stromkompis_data_2025', JSON.stringify(data));
      localStorage.setItem('stromkompis_zone_2025', selectedZone);
      localStorage.setItem('stromkompis_surcharge_2025', surcharge.toString());
    }
  }, [data, selectedZone, surcharge, isLoaded]);

  const generateDataForZone = (zoneKey: string, keepConsumption: boolean = false, surchargeValue: number | '' = 0) => {
    const zonePrices = PRICE_ZONES[zoneKey].prices;
    const surchargeNum = Number(surchargeValue);
    
    const currentConsumption = keepConsumption && data.length > 0 
      ? data.map(d => d.consumption) 
      : DEFAULT_CONSUMPTION;

    const newData: MonthlyData[] = MONTHS.map((month, index) => ({
      month: month,
      consumption: currentConsumption[index],
      spotPrice: zonePrices[index] + surchargeNum
    }));

    setData(newData);
    setSelectedZone(zoneKey);
    setSurcharge(surchargeValue);
  };

  // --- HANDLERS ---

  const handleZoneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newZone = e.target.value;
    generateDataForZone(newZone, true, surcharge);
  };

  const handleSurchargeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value === '' ? '' : Number(e.target.value);
    generateDataForZone(selectedZone, true, val);
  };

  const handleInputChange = (index: number, field: keyof MonthlyData, value: string) => {
    const newData = [...data];
    // Tillater tom streng, ellers konverter til tall
    const numericValue = value === '' ? '' : Number(value);
    
    // @ts-ignore
    newData[index][field] = numericValue;
    setData(newData);
  };

  // Håndterer Enter-tastetrykk for navigasjon
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Hindre default form submit om det finnes
      // Sjekk om det finnes et neste felt
      if (index + 1 < consumptionRefs.current.length) {
        consumptionRefs.current[index + 1]?.focus();
      }
    }
  };

  const handleReset = () => {
    if (window.confirm("Er du sikker? Dette vil slette dine endringer og tilbakestille til standard 2025-verdier.")) {
      localStorage.removeItem('stromkompis_data_2025');
      localStorage.removeItem('stromkompis_zone_2025');
      localStorage.removeItem('stromkompis_surcharge_2025');
      generateDataForZone('NO3', false, 0);
    }
  };

  // --- KALKULERINGER ---
  const results: CalculationSummary = useMemo(() => {
    let totalCostNorgespris = 0;
    let totalCostStromstotte = 0;

    const monthlyResults = data.map((item) => {
      // Sikre at vi bruker 0 i beregninger hvis feltet er tomt
      const consumption = Number(item.consumption);
      const spotPrice = Number(item.spotPrice);

      // 1. Norgespris
      const costNorgespris = (consumption * NORGESPRIS_ORE) / 100;

      // 2. Strømstøtte
      let effectivePriceOre = spotPrice;
      if (spotPrice > STROMSTOTTE_TAK_ORE) {
        effectivePriceOre = STROMSTOTTE_TAK_ORE;
      }
      const costStromstotte = (consumption * effectivePriceOre) / 100;

      const savings = costStromstotte - costNorgespris;

      totalCostNorgespris += costNorgespris;
      totalCostStromstotte += costStromstotte;

      return {
        month: item.month,
        consumption,
        spotPrice,
        costNorgespris,
        costStromstotte,
        savings
      } as CalculationResultItem;
    });

    return {
      monthly: monthlyResults,
      totalNorgespris: totalCostNorgespris,
      totalStromstotte: totalCostStromstotte,
      totalDifference: totalCostStromstotte - totalCostNorgespris
    };
  }, [data]);

  if (!isLoaded) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col lg:flex-row justify-between items-center gap-6 border-b border-slate-200 pb-6">
          <div className="text-center lg:text-left">
            <div className="flex justify-center lg:justify-start items-center gap-3 text-blue-600 mb-2">
              <Zap size={32} fill="currentColor" />
              <h1 className="text-3xl font-bold tracking-tight">Strømkalkulatoren</h1>
            </div>
            <p className="text-slate-500">Sammenlign "Strømstøtte" vs. "Norgespris" (2025-tall)</p>
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
                  {Object.entries(PRICE_ZONES).map(([key]) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
             </div>

             {/* Påslag input */}
             <div className="flex flex-col">
                <label className="text-xs text-slate-400 font-semibold uppercase mb-1 flex items-center gap-1">
                  <PlusCircle size={12} /> Påslag (øre)
                </label>
                <input 
                  type="number"
                  value={surcharge}
                  onChange={handleSurchargeChange}
                  className="bg-slate-50 border border-slate-300 text-slate-800 text-sm rounded focus:ring-blue-500 focus:border-blue-500 block w-24 p-2"
                  placeholder="0"
                />
             </div>

             <div className="border-l border-slate-200 pl-4 ml-2 h-10 flex items-center">
               <button 
                  onClick={handleReset}
                  className="text-slate-400 hover:text-red-500 p-2 rounded-full hover:bg-slate-50 transition-colors"
                  title="Tilbakestill alt til standard"
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
                Spotprisene inkluderer nå påslaget ditt ({surcharge} øre).
                Trykk <strong>Enter</strong> for å hoppe til neste måned.
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
                  <th className="px-4 py-3">Spotpris + påslag</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, index) => (
                  <tr key={row.month} className="border-b hover:bg-slate-50 transition-colors group">
                    <td className="px-4 py-3 font-medium bg-slate-50 group-hover:bg-slate-100 w-24">{row.month}</td>
                    <td className="px-4 py-2">
                      <input
                        // Lagrer referansen til input-feltet
                        ref={(el) => { consumptionRefs.current[index] = el; }}
                        type="number"
                        min="0"
                        className="w-full max-w-[120px] px-3 py-2 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                        value={row.consumption}
                        onChange={(e) => handleInputChange(index, 'consumption', e.target.value)}
                        // Lytter etter Enter-tasten
                        onKeyDown={(e) => handleKeyDown(e, index)}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min="0"
                        className={`w-full max-w-[120px] px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow ${
                          row.spotPrice !== (PRICE_ZONES[selectedZone].prices[index] + Number(surcharge)) 
                            ? 'bg-yellow-50 border-yellow-300' 
                            : 'bg-white border-slate-300'
                        }`}
                        title={row.spotPrice !== (PRICE_ZONES[selectedZone].prices[index] + Number(surcharge)) ? "Denne måneden er manuelt endret" : ""}
                        value={row.spotPrice}
                        onChange={(e) => handleInputChange(index, 'spotPrice', e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Resultat Oppsummering - Store Kort */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
            <div>
              <h3 className="text-slate-500 font-medium mb-1">Dagens ordning (Strømstøtte)</h3>
              <p className="text-xs text-slate-400 mb-4">Du betaler spotpris opp til taket</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-slate-800">{Math.round(results.totalStromstotte).toLocaleString()} kr</p>
              <p className="text-xs text-slate-400 mt-2 border-t pt-2 border-slate-100">
                Tak: {STROMSTOTTE_TAK_ORE} øre/kWh
              </p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
            <div>
              <h3 className="text-slate-500 font-medium mb-1">Norgespris</h3>
              <p className="text-xs text-slate-400 mb-4">Fast pris uansett marked</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-blue-600">{Math.round(results.totalNorgespris).toLocaleString()} kr</p>
              <p className="text-xs text-slate-400 mt-2 border-t pt-2 border-slate-100">
                Fastpris: {NORGESPRIS_ORE} øre/kWh
              </p>
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

        {/* Fotnote */}
        <div className="text-center text-slate-400 text-sm pb-8 space-y-2">
          <p>NB: Utregningene inkluderer ikke nettleie eller faste avgifter, kun energileddet.</p>
          <p>Dine endringer lagres automatisk i nettleseren.</p>
        </div>

      </div>
    </div>
  );
};

export default App;