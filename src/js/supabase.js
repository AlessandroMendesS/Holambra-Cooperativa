

const credenciais = {
    url: 'https://unhnwdrcnrlmzhufcxpo.supabase.co',
    chave: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuaG53ZHJjbnJsbXpodWZjeHBvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNzgyODksImV4cCI6MjA4Njc1NDI4OX0.7aFSS7_M-m6HBeBrjNj4DZTec1ly5S7ew1-DgUxXiLQ'
};


if (typeof window.supabase === 'undefined') {
    console.error('Supabase library not loaded. Check script imports.');
    alert('Erro Fatal: Biblioteca do Supabase não carregou. Verifique sua conexão.');
}

const supabase = window.supabase.createClient(credenciais.url, credenciais.chave);

export { supabase };
