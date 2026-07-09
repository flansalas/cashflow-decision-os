const fs = require('fs');
let code = fs.readFileSync('src/app/review/page.tsx', 'utf8');

// Add VarianceDriverResult to imports
if (!code.includes('VarianceDriverResult')) {
    code = code.replace(
        'import { VarianceDriverPanel } from "@/ui/VarianceDriverPanel";',
        'import { VarianceDriverPanel } from "@/ui/VarianceDriverPanel";\nimport type { VarianceDriverResult } from "@/services/variance-drivers";'
    );
}

// Add state for variance drivers
if (!code.includes('driverData')) {
    code = code.replace(
        'const [viewHistorical, setViewHistorical] = useState<string | null>(null);',
        `const [viewHistorical, setViewHistorical] = useState<string | null>(null);
    const [driverData, setDriverData] = useState<VarianceDriverResult | null>(null);
    const [driverLoading, setDriverLoading] = useState(false);`
    );
}

// Fetch driver data when historical review is loaded
if (!code.includes('loadDriverData')) {
    code = code.replace(
        'const activeData = viewHistorical ? data.historical.find((h: any) => h.weekStart === viewHistorical) : data.active;',
        `const activeData = viewHistorical ? data.historical.find((h: any) => h.weekStart === viewHistorical) : data.active;
    
    useEffect(() => {
        if (isHistorical && activeData?.checkpoint?.id) {
            setDriverLoading(true);
            fetch(\`/api/variance-drivers?checkpointId=\${activeData.checkpoint.id}\`)
                .then(r => r.json())
                .then(d => setDriverData(d.error ? null : d))
                .catch(() => setDriverData(null))
                .finally(() => setDriverLoading(false));
        } else {
            setDriverData(null);
        }
    }, [viewHistorical, activeData?.checkpoint?.id]);`
    );
}

// Render the variance driver panel
code = code.replace(
    /\{\/\* Post-Approval Changes \*\/\}/,
    `{/* Variance Drivers */}
                {isHistorical && driverData && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-8">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                            <h3 className="font-bold text-slate-800 text-sm">Variance Drivers</h3>
                        </div>
                        <div className="p-6">
                            <VarianceDriverPanel data={driverData} />
                        </div>
                    </div>
                )}
                
                {/* Post-Approval Changes */}`
);

fs.writeFileSync('src/app/review/page.tsx', code);
