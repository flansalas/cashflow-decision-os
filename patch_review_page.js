const fs = require('fs');
let code = fs.readFileSync('src/app/review/page.tsx', 'utf8');

// Remove dashboard data fetch
code = code.replace(
    'const [dashboardData, setDashboardData] = useState<any>(null);',
    ''
);

code = code.replace(
    `        Promise.all([
            fetch(\`/api/review?companyId=\${companyId}\`).then(r => r.json()),
            fetch(\`/api/dashboard?companyId=\${companyId}\`).then(r => r.json())
        ])
            .then(([d, dash]) => {
                if (d.error) setError(d.error);
                else {
                    setData(d);
                    setDashboardData(dash);
                    setError(null);
                }
            })`,
    `        fetch('/api/review', { headers: { 'Accept': 'application/json' } })
            .then(r => r.json())
            .then(d => {
                if (d.error) setError(d.error);
                else {
                    setData(d);
                    setError(null);
                }
            })`
);

// We need to pass the ExecutionPlan ID to handleRollComplete, but Wait, we just pass executionPlanId to UpdateBalanceDialog when saving? No, UpdateBalanceDialog triggers `/api/cash-checkin`.
// So we must pass it to UpdateBalanceDialog to include in the check-in! Wait, UpdateBalanceDialog doesn't accept executionPlanId prop right now.
// I will patch UpdateBalanceDialog to accept `executionPlanId?: string` and pass it to `/api/cash-checkin`.

code = code.replace(
    /handleRollComplete = async \(\) => \{[\s\S]*?setShowRoll\(false\);\n        loadData\(\);\n    \};/,
    `handleRollComplete = async () => {
        setShowRoll(false);
        loadData();
    };`
);

// Fix condition in Roll Dialog Orchestration
code = code.replace(
    `{showRoll && data?.forecast && (`,
    `{showRoll && data?.active?.latestForecast && (`
);

code = code.replace(
    `currentBalance={dashboardData?.cash?.bankBalance || 0}
                    currentAdjustments={dashboardData?.cash?.adjustments || []}
                    companyId={companyId!}
                    priorWeekData={data.forecast.forecastResult?.weeks?.[0]}
                    lastUpdated={dashboardData?.lastUpdated}`,
    `currentBalance={data.cash?.bankBalance || 0}
                    currentAdjustments={data.cash?.adjustments || []}
                    companyId={companyId!}
                    executionPlanId={data.active.revisedPlan?.id || data.active.originalPlan?.id}
                    priorWeekData={data.active.latestForecast}
                    lastUpdated={data.lastUpdated}`
);

// Remove BacklogTriage for now since we aren't fetching the backlog properly, OR we can fetch it. Let's just remove BacklogTriage from the review page as the user explicitly said to reuse VarianceDriverPanel, and `UpdateBalanceDialog` handles triage. Wait! "Implement the actual Weekly Review variance section: Render the existing VarianceDriverPanel. Load the data it requires using the established variance-driver API/service... The review must show the supported drivers... Confirm that the drivers reconcile to the displayed total variance."
// Ah, the VarianceDriverPanel should be rendered ON the review page!
// Let's add VarianceDriverPanel loading!

fs.writeFileSync('src/app/review/page.tsx', code);
