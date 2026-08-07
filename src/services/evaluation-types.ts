export type ResidualForecastSeries = {
  inflow: number[];
  outflow: number[];
};

export function parseResidualForecastSeries(jsonStr: any): ResidualForecastSeries | null {
    if (!jsonStr) return null;
    try {
        const obj = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
        if (!obj || typeof obj !== 'object') return null;
        if (!Array.isArray(obj.inflow) || obj.inflow.length !== 13) return null;
        if (!Array.isArray(obj.outflow) || obj.outflow.length !== 13) return null;
        return {
            inflow: obj.inflow.map(Number),
            outflow: obj.outflow.map(Number)
        };
    } catch (e) {
        return null;
    }
}
