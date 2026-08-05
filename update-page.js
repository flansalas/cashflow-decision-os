const fs = require('fs');

let content = fs.readFileSync('src/app/plan/page.tsx', 'utf-8');

content = content.replace(
    'import { useOrganization, useAuth } from "@clerk/nextjs";',
    'import { useOrganization, useAuth, RedirectToSignIn } from "@clerk/nextjs";'
);

// Remove companyId from states
content = content.replace(
    '    const urlCompanyId = searchParams.get("companyId");\n    const [companyId, setCompanyId] = useState<string | null>(null);',
    ''
);

// Remove effectiveCompanyId fallback
content = content.replace(
    /    const effectiveCompanyId = organization \n        \? data\?\.company\.id \?\? null \n        : \(companyId \?\? urlCompanyId \?\? \(typeof window !== "undefined" \? localStorage\.getItem\("cfdo_company_id"\) : null\)\);/,
    '    const effectiveCompanyId = data?.company.id ?? null;'
);

// Remove the two useEffects related to local storage and url params
content = content.replace(
    /    \/\/ Resolve companyId: URL param > localStorage > default \(demo\)\n    useEffect\(\(\) => \{\n        if \(organization\) return; \/\/ Ignore if clerk is active\n        if \(urlCompanyId\) \{\n            localStorage\.setItem\("cfdo_company_id", urlCompanyId\);\n            setCompanyId\(urlCompanyId\);\n        \} else \{\n            const saved = localStorage\.getItem\("cfdo_company_id"\);\n            setCompanyId\(saved \?\? null\);\n        \}\n    \}, \[urlCompanyId, organization\]\);\n\n    \/\/ When Clerk active org changes, forcefully unset the legacy local companyId\n    \/\/ to strictly allow the backend `resolveTenant` to serve the active org data\.\n    useEffect\(\(\) => \{\n        if \(organization\) \{\n            setCompanyId\(null\); \/\/ Bypass local fallback so backend prioritizes orgId\n            \n            \/\/ Clean up the URL if there's a stale companyId\n            if \(window\.location\.search\.includes\('companyId='\)\) \{\n                const url = new URL\(window\.location\.href\);\n                url\.searchParams\.delete\('companyId'\);\n                window\.history\.replaceState\(\{\}, '', url\.toString\(\)\);\n            \}\n        \}\n    \}, \[organization\?\.id\]\);/,
    ''
);

// Update fetchDashboard
content = content.replace(
    /    const fetchDashboard = \(cid\?: string \| null\) => \{\n        const id = cid \?\? companyId;\n        const url = id \? `\/api\/dashboard\?companyId=\$\{id\}` : "\/api\/dashboard";/,
    '    const fetchDashboard = () => {\n        const url = "/api/dashboard";\n        const id = null;'
);

// Update main useEffect
content = content.replace(
    /    useEffect\(\(\) => \{\n        \/\/ Guard: Wait for Clerk to be fully loaded before any fetch\n        if \(!isAuthLoaded \|\| !isOrgLoaded\) return;\n\n        if \(isSignedIn\) \{\n            if \(organization\) \{\n                fetchDashboard\(null\); \/\/ Org is active — backend uses Clerk orgId\n            \}\n            \/\/ Signed in but org not active yet — AppSidebar setActive will re-trigger this effect\n        \} else \{\n            \/\/ Unauthenticated \/ ghost layer\n            fetchDashboard\(companyId !== null \? companyId : null\);\n        \}\n        \/\/ eslint-disable-next-line react-hooks\/exhaustive-deps\n    \}, \[isAuthLoaded, isOrgLoaded, isSignedIn, companyId, organization\?\.id\]\);/,
    `    useEffect(() => {
        if (!isAuthLoaded || !isOrgLoaded) return;
        if (isSignedIn && organization) {
            fetchDashboard();
        }
    }, [isAuthLoaded, isOrgLoaded, isSignedIn, organization?.id]);`
);

// Replace the loading state with the required guards
const oldLoading = `    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
                <div className="text-center space-y-4">
                    <div className="animate-spin w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full mx-auto" />
                    <p style={{ color: 'var(--text-muted)' }} className="text-sm tracking-wide">Loading forecast…</p>
                </div>
            </div>
        );
    }`;

const newLoading = `    if (!isAuthLoaded || !isOrgLoaded) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
                <div className="text-center space-y-4">
                    <div className="animate-spin w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full mx-auto" />
                    <p style={{ color: 'var(--text-muted)' }} className="text-sm tracking-wide">Authenticating…</p>
                </div>
            </div>
        );
    }

    if (!isSignedIn) {
        return <RedirectToSignIn />;
    }

    if (!organization) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
                <div className="border rounded-xl p-8 max-w-md text-center" style={{ background: '#fff', borderColor: 'var(--border-subtle)' }}>
                    <p className="text-base font-medium mb-3">Please select an organization</p>
                    <p className="text-sm text-gray-500">You must select an active organization to view this dashboard.</p>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
                <div className="text-center space-y-4">
                    <div className="animate-spin w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full mx-auto" />
                    <p style={{ color: 'var(--text-muted)' }} className="text-sm tracking-wide">Loading forecast…</p>
                </div>
            </div>
        );
    }`;

content = content.replace(oldLoading, newLoading);

fs.writeFileSync('src/app/plan/page.tsx', content);
