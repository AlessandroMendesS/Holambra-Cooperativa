import { readFileSync, writeFileSync, existsSync } from 'fs';

function carregarDotEnv() {
    if (!existsSync('.env')) return;
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    }
}

carregarDotEnv();

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !anonKey) {
    console.error('ERRO: defina SUPABASE_URL e SUPABASE_ANON_KEY nas Environment variables da Netlify (ou no .env local).');
    process.exit(1);
}

const conteudo = `window.__SUPABASE_RUNTIME__=${JSON.stringify({ url, anonKey })};\n`;
writeFileSync('supabase-runtime.js', conteudo);
console.log('supabase-runtime.js gerado com sucesso.');
