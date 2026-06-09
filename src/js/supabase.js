
let _client = null;

function lerConfigRuntime() {
    const cfg = window.__SUPABASE_RUNTIME__;
    if (!cfg?.url || !cfg?.anonKey) return null;
    return { url: cfg.url, anonKey: cfg.anonKey };
}

export async function initSupabase() {
    if (_client) return _client;

    if (typeof window.supabase === 'undefined') {
        throw new Error('Biblioteca do Supabase não carregou.');
    }

    const cfg = lerConfigRuntime();
    if (!cfg) {
        throw new Error(
            'Credenciais do Supabase não encontradas. Na Netlify, configure SUPABASE_URL e SUPABASE_ANON_KEY e faça um novo deploy.'
        );
    }

    _client = window.supabase.createClient(cfg.url, cfg.anonKey);
    return _client;
}

export const supabase = new Proxy(
    {},
    {
        get(_target, prop) {
            if (!_client) {
                throw new Error('Supabase ainda não foi inicializado.');
            }
            const val = _client[prop];
            return typeof val === 'function' ? val.bind(_client) : val;
        }
    }
);
