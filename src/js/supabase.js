
let _client = null;

export async function initSupabase() {
    if (_client) return _client;

    if (typeof window.supabase === 'undefined') {
        throw new Error('Biblioteca do Supabase não carregou.');
    }

    const resp = await fetch('/.netlify/functions/supabase-config', { cache: 'no-store' });
    if (!resp.ok) {
        throw new Error('Não foi possível carregar as credenciais do Supabase (Netlify Functions).');
    }

    const cfg = await resp.json();
    if (cfg.error || !cfg.url || !cfg.anonKey) {
        throw new Error(cfg.error || 'Resposta inválida da função supabase-config.');
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
