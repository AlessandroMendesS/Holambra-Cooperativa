
import { supabase } from './supabase.js';

// --- Estado e Refs ---
const estado = {
    usuario: null,
    perfil: null,
    usuarios: [],
    programacoesUsuario: [] // OS programadas para o usuário (para preencher apontamento)
};

const telas = {
    login: document.getElementById('tela-login'),
    cadastro: document.getElementById('tela-cadastro'),
    menu: document.getElementById('tela-menu'),
    dashboard: document.getElementById('tela-dashboard'),
    historico: document.getElementById('tela-historico'),
    admin: document.getElementById('tela-admin'),
    bancoHoras: document.getElementById('tela-banco-horas'),
    horaExtra: document.getElementById('tela-hora-extra'),
    veiculos: document.getElementById('tela-veiculos'),
    programar: document.getElementById('tela-programar'),
    programacao: document.getElementById('tela-programacao'),
    ferias: document.getElementById('tela-ferias')
};

const cabecalho = document.getElementById('cabecalho-principal');
const menuMobile = document.getElementById('menu-mobile');

// --- Teste de Conexão ---
async function testarConexao() {
    const statusDiv = document.getElementById('status-sistema');
    if (!statusDiv) return;

    try {
        const { data, error } = await supabase.from('perfis').select('count', { count: 'exact', head: true });

        if (error && error.code !== 'PGRST116') {
            console.log('Erro conexao:', error);
            if (error.message.includes('fetch')) throw error;
        }

        statusDiv.innerHTML = '<span style="color: green;">● Sistema Online</span>';
        console.log('Supabase Conectado!');
    } catch (err) {
        console.error(err);
        statusDiv.innerHTML = '<span style="color: red;">● Erro de Conexão</span>';
    }
}
testarConexao();

// --- Utils: SweetAlert2 ---
const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
});

function mostrarErro(titulo, mensagem) {
    Swal.fire({
        icon: 'error',
        title: titulo,
        text: mensagem,
        confirmButtonColor: '#004175'
    });
}

function mostrarSucesso(titulo) {
    Swal.fire({
        icon: 'success',
        title: titulo,
        showConfirmButton: false,
        timer: 1500
    });
}

// --- Navegação ---
function navegarPara(idTela) {
    window.scrollTo(0, 0);
    Object.values(telas).forEach(el => { if (el) el.classList.add('oculto'); });

    const telaAlvo = telas[idTela];
    if (telaAlvo) {
        telaAlvo.classList.remove('oculto');
        lucide.createIcons();
    }

    if (cabecalho) {
        if (idTela === 'login' || idTela === 'cadastro') cabecalho.classList.add('oculto');
        else cabecalho.classList.remove('oculto');
    }
    if (menuMobile) menuMobile.classList.add('oculto');

    if (idTela === 'menu') {
        // Atualizar visibilidade dos menus baseado no perfil
        const navAdmin = document.getElementById('nav-admin');
        const navHoraExtra = document.getElementById('nav-hora-extra');
        if (estado.perfil && estado.perfil.funcao === 'admin') {
            if (navAdmin) navAdmin.classList.remove('oculto');
            if (navHoraExtra) navHoraExtra.classList.remove('oculto');
            document.getElementById('menu-usuario').classList.add('oculto');
            document.getElementById('menu-admin').classList.remove('oculto');
        } else {
            if (navAdmin) navAdmin.classList.add('oculto');
            if (navHoraExtra) navHoraExtra.classList.add('oculto');
            document.getElementById('menu-usuario').classList.remove('oculto');
            document.getElementById('menu-admin').classList.add('oculto');
        }
    }
    if (idTela === 'dashboard') {
        carregarUsuarios();
        atualizarVisibilidadeCamposAdmin();
    }
    if (idTela === 'historico') carregarHistorico();
    if (idTela === 'admin') carregarDadosAdmin();
    if (idTela === 'bancoHoras') {
        carregarUsuarios();
        carregarBancoHoras();
    }
    if (idTela === 'horaExtra') {
        carregarUsuarios();
        carregarHoraExtra();
    }
    if (idTela === 'ferias') {
        carregarUsuarios();
        carregarFerias();
    }
    if (idTela === 'veiculos') {
        carregarVeiculos().catch(e => {
            console.error('Erro ao carregar veículos:', e);
            const lista = document.getElementById('lista-veiculos');
            if (lista) lista.innerHTML = `<div class="card centro" style="padding: 2rem; color: #991b1b;">Erro ao carregar. Verifique se executou supabase_setup_veiculos.sql</div>`;
        });
    }
    if (idTela === 'programar') carregarProgramacoesAdmin();
    if (idTela === 'programacao') carregarProgramacaoDiaria();
    if (idTela === 'dashboard') carregarProgramacoesParaApontamento();
}

// Função para mostrar/ocultar campos de conforme planejado (dois botões Sim/Não). initialConforme: true/false/null (edição)
function atualizarVisibilidadeCamposAdmin(initialConforme = null) {
    const grupoConforme = document.getElementById('grupo-conforme-planejado');
    const grupoJustificativa = document.getElementById('grupo-justificativa');
    const hiddenConforme = document.getElementById('apt-conforme-planejado');
    const campoJustificativa = document.getElementById('apt-justificativa');
    const aptDesc = document.getElementById('apt-desc');
    const btnSim = document.getElementById('btn-conforme-sim');
    const btnNao = document.getElementById('btn-conforme-nao');

    if (!grupoConforme) return;

    grupoConforme.classList.remove('oculto');
    grupoConforme.style.display = 'block';

    function setConforme(val) {
        if (hiddenConforme) hiddenConforme.value = val === true ? 'sim' : val === false ? 'nao' : '';
        if (grupoJustificativa && campoJustificativa) {
            const mostrar = val === false;
            grupoJustificativa.classList.toggle('oculto', !mostrar);
            grupoJustificativa.style.display = mostrar ? 'block' : 'none';
            campoJustificativa.required = mostrar;
            if (!mostrar) campoJustificativa.value = '';
        }
        if (aptDesc) aptDesc.required = val === false;
        if (btnSim) {
            btnSim.classList.toggle('btn-primario', val === true);
            btnSim.classList.toggle('btn-secundario', val !== true);
        }
        if (btnNao) {
            btnNao.classList.toggle('btn-primario', val === false);
            btnNao.classList.toggle('btn-outline', val !== false);
        }
        lucide.createIcons();
    }

    if (btnSim) btnSim.replaceWith(btnSim.cloneNode(true));
    if (btnNao) btnNao.replaceWith(btnNao.cloneNode(true));
    document.getElementById('btn-conforme-sim')?.addEventListener('click', () => setConforme(true));
    document.getElementById('btn-conforme-nao')?.addEventListener('click', () => setConforme(false));

    setConforme(initialConforme !== undefined && initialConforme !== null ? initialConforme : null);
}

// Listeners Menu
document.getElementById('alternar-menu').addEventListener('click', () => menuMobile.classList.remove('oculto'));
document.getElementById('fechar-menu').addEventListener('click', () => menuMobile.classList.add('oculto'));

document.getElementById('nav-inicio').addEventListener('click', () => navegarPara('menu'));
document.getElementById('nav-historico').addEventListener('click', () => navegarPara('historico'));
document.getElementById('nav-admin').addEventListener('click', () => navegarPara('admin'));
document.getElementById('nav-hora-extra')?.addEventListener('click', () => navegarPara('horaExtra'));
document.getElementById('nav-veiculos')?.addEventListener('click', () => navegarPara('veiculos'));
document.getElementById('nav-programacao')?.addEventListener('click', () => navegarPara('programacao'));
document.getElementById('nav-programar')?.addEventListener('click', () => navegarPara('programar'));
document.getElementById('nav-sair').addEventListener('click', async () => {
    await supabase.auth.signOut();
    estado.usuario = null;
    estado.perfil = null;
    // Ocultar menu admin ao sair
    document.getElementById('nav-admin')?.classList.add('oculto');
    document.getElementById('nav-hora-extra')?.classList.add('oculto');
    document.getElementById('nav-programar')?.classList.add('oculto');
    document.getElementById('menu-usuario').classList.remove('oculto');
    document.getElementById('menu-admin').classList.add('oculto');
    navegarPara('login');
});

document.getElementById('btn-ir-cadastro').addEventListener('click', () => navegarPara('cadastro'));
document.getElementById('btn-voltar-login').addEventListener('click', () => navegarPara('login'));

// Toggle mostrar/ocultar senha
document.getElementById('toggle-senha').addEventListener('click', () => {
    const inputSenha = document.getElementById('login-senha');
    const iconSenha = document.getElementById('icon-senha');

    if (inputSenha.type === 'password') {
        inputSenha.type = 'text';
        iconSenha.setAttribute('data-lucide', 'eye-off');
    } else {
        inputSenha.type = 'password';
        iconSenha.setAttribute('data-lucide', 'eye');
    }
    lucide.createIcons();
});
document.getElementById('btn-novo-apt').addEventListener('click', () => {
    apontamentoEditando = null;
    document.getElementById('formulario-apontamento').reset();
    document.querySelector('#tela-dashboard h2').textContent = 'Registrar Serviço';
    const btnSubmit = document.querySelector('#formulario-apontamento button[type="submit"]');
    if (btnSubmit) {
        btnSubmit.innerHTML = '<i data-lucide="check-circle"></i> SALVAR APONTAMENTO';
        btnSubmit.dataset.modo = '';
    }
    mostrarOcultarAptOrdemManual();
    atualizarVisibilidadeCamposAdmin();
    navegarPara('dashboard');
});
document.getElementById('btn-menu-apontamentos').addEventListener('click', () => {
    apontamentoEditando = null;
    document.getElementById('formulario-apontamento').reset();
    document.querySelector('#tela-dashboard h2').textContent = 'Registrar Serviço';
    const btnSubmit = document.querySelector('#formulario-apontamento button[type="submit"]');
    if (btnSubmit) {
        btnSubmit.innerHTML = '<i data-lucide="check-circle"></i> SALVAR APONTAMENTO';
        btnSubmit.dataset.modo = '';
    }
    mostrarOcultarAptOrdemManual();
    atualizarVisibilidadeCamposAdmin();
    navegarPara('dashboard');
});
document.getElementById('btn-menu-historico').addEventListener('click', () => navegarPara('historico'));
document.getElementById('btn-voltar-historico').addEventListener('click', () => navegarPara('menu'));
document.getElementById('btn-menu-admin').addEventListener('click', () => navegarPara('admin'));
document.getElementById('btn-menu-banco-horas').addEventListener('click', () => {
    navegarPara('bancoHoras');
    carregarBancoHoras();
});
document.getElementById('btn-menu-hora-extra').addEventListener('click', () => {
    navegarPara('horaExtra');
    carregarHoraExtra();
});
document.getElementById('btn-menu-hora-extra-admin')?.addEventListener('click', () => {
    navegarPara('horaExtra');
    carregarHoraExtra();
});
document.getElementById('btn-menu-ferias').addEventListener('click', () => {
    navegarPara('ferias');
    carregarFerias();
});
document.getElementById('btn-menu-veiculos')?.addEventListener('click', () => {
    navegarPara('veiculos');
});
document.getElementById('btn-menu-veiculos-admin')?.addEventListener('click', () => {
    navegarPara('veiculos');
});
document.getElementById('btn-menu-programacao')?.addEventListener('click', () => navegarPara('programacao'));
document.getElementById('btn-menu-programar-admin')?.addEventListener('click', () => navegarPara('programar'));
document.getElementById('btn-voltar-menu').addEventListener('click', () => navegarPara('menu'));
document.getElementById('btn-voltar-menu-bh').addEventListener('click', () => navegarPara('menu'));
document.getElementById('btn-voltar-menu-he').addEventListener('click', () => navegarPara('menu'));
document.getElementById('btn-voltar-menu-ferias').addEventListener('click', () => navegarPara('menu'));
document.getElementById('btn-voltar-menu-veiculos')?.addEventListener('click', () => navegarPara('menu'));
document.getElementById('btn-voltar-menu-programar')?.addEventListener('click', () => navegarPara('menu'));
document.getElementById('btn-voltar-menu-programacao')?.addEventListener('click', () => navegarPara('menu'));

// --- Autenticação ---

async function verificarUsuario() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        estado.usuario = session.user;

        // Tentar buscar perfil com retentativa (pois o trigger pode demorar ms)
        let tentativas = 0;
        let perfilEncontrado = null;

        while (tentativas < 5 && !perfilEncontrado) {
            const { data, error } = await supabase
                .from('perfis')
                .select('*')
                .eq('id', estado.usuario.id)
                .single();

            if (data) {
                perfilEncontrado = data;
            } else {
                tentativas++;
                // Esperar 500ms antes de tentar de novo
                await new Promise(r => setTimeout(r, 500));
            }
        }

        if (perfilEncontrado) {
            estado.perfil = perfilEncontrado;
            const navAdmin = document.getElementById('nav-admin');
            const navHoraExtra = document.getElementById('nav-hora-extra');
            const navProgramar = document.getElementById('nav-programar');
            if (estado.perfil.funcao === 'admin') {
                if (navAdmin) navAdmin.classList.remove('oculto');
                if (navHoraExtra) navHoraExtra.classList.remove('oculto');
                if (navProgramar) navProgramar.classList.remove('oculto');
                // Mostrar apenas menu admin na tela inicial
                document.getElementById('menu-usuario').classList.add('oculto');
                document.getElementById('menu-admin').classList.remove('oculto');
            } else {
                // Ocultar menu admin para usuários normais
                if (navAdmin) navAdmin.classList.add('oculto');
                if (navHoraExtra) navHoraExtra.classList.add('oculto');
                if (navProgramar) navProgramar.classList.add('oculto');
                // Mostrar menu normal para usuários
                document.getElementById('menu-usuario').classList.remove('oculto');
                document.getElementById('menu-admin').classList.add('oculto');
            }
            navegarPara('menu');
        } else {
            console.error('Perfil não encontrado após retentativas.');
            // Se falhar mesmo assim, talvez redirecionar para uma tela de "Complete seu cadastro" ou erro
            // Por enquanto, forçamos o dashboard mas avisamos
            navegarPara('dashboard');
            mostrarErro('Perfil Em Processamento', 'Seus dados ainda estão sendo processados. Recarregue a página em instantes.');
        }
    } else {
        navegarPara('login');
    }
}

// Login (NOME para usuários, EMAIL para admin)
document.getElementById('formulario-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputLogin = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;

    // Verificação de Admin (usa email)
    const ADMIN_EMAIL = 'leticiamendes123z@gmail.com';
    const ADMIN_SENHA = 'Hab16313@';
    const isAdmin = inputLogin === ADMIN_EMAIL && senha === ADMIN_SENHA;

    let email = inputLogin;

    // Se não for admin, buscar email pelo nome
    if (!isAdmin) {
        const { data: perfisData, error: perfilError } = await supabase
            .from('perfis')
            .select('email, nome_completo')
            .ilike('nome_completo', `%${inputLogin}%`);

        if (perfilError || !perfisData || perfisData.length === 0) {
            mostrarErro('Falha no Login', 'Nome de usuário não encontrado. Verifique se digitou corretamente.');
            return;
        }

        // Se houver múltiplos resultados, tentar encontrar correspondência exata
        let perfilData = perfisData.find(p => p.nome_completo.toLowerCase() === inputLogin.toLowerCase());
        if (!perfilData && perfisData.length === 1) {
            perfilData = perfisData[0];
        } else if (!perfilData && perfisData.length > 1) {
            mostrarErro('Falha no Login', 'Múltiplos usuários encontrados. Digite o nome completo.');
            return;
        }

        if (!perfilData || !perfilData.email) {
            mostrarErro('Falha no Login', 'Email não encontrado para este usuário.');
            return;
        }

        email = perfilData.email;
    }

    let { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });

    // Se login falhar e for admin, tentar criar a conta
    if (error && isAdmin) {
        // Verificar se o erro é porque o usuário não existe
        if (error.message.includes('Invalid login') || error.message.includes('Email not confirmed') || error.message.includes('User not found')) {
            // Tentar criar conta admin se não existir
            Swal.fire({
                title: 'Criando conta de administrador...',
                text: 'Aguarde...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
                email: ADMIN_EMAIL,
                password: ADMIN_SENHA,
                options: {
                    data: {
                        nome_completo: 'Administrador',
                        funcao: 'admin'
                    },
                    emailRedirectTo: window.location.origin
                }
            });

            Swal.close();

            if (signUpError) {
                // Se der erro ao criar, pode ser que o email já exista mas precisa confirmar
                // Tentar login novamente após um delay
                await new Promise(r => setTimeout(r, 1000));
                const retry = await supabase.auth.signInWithPassword({ email, password: senha });
                if (retry.error) {
                    mostrarErro('Falha no Login', 'Verifique se o email foi confirmado ou tente novamente em alguns instantes.');
                    return;
                }
                data = retry.data;
            } else if (signUpData.user) {
                // Se criou com sucesso, pode precisar confirmar email ou já fazer login
                if (signUpData.session) {
                    data = signUpData;
                } else {
                    // Aguardar um pouco e tentar login
                    await new Promise(r => setTimeout(r, 1500));
                    const loginRetry = await supabase.auth.signInWithPassword({ email, password: senha });
                    if (loginRetry.error) {
                        mostrarErro('Conta Criada', 'Verifique seu email para confirmar a conta ou tente fazer login novamente.');
                        return;
                    }
                    data = loginRetry.data;
                }
            }
        } else {
            mostrarErro('Falha no Login', error.message);
            return;
        }
    } else if (error) {
        mostrarErro('Falha no Login', 'Email ou senha incorretos.');
        return;
    }

    if (data && data.user) {
        // Se for admin, garantir que o perfil tenha função admin
        if (isAdmin) {
            // Aguardar um pouco para o trigger criar o perfil (se necessário)
            await new Promise(r => setTimeout(r, 1500));

            // Tentar buscar o perfil várias vezes
            let perfilData = null;
            for (let i = 0; i < 5; i++) {
                const { data: perfil, error: perfilError } = await supabase
                    .from('perfis')
                    .select('*')
                    .eq('id', data.user.id)
                    .single();

                if (perfil && !perfilError) {
                    perfilData = perfil;
                    break;
                }
                await new Promise(r => setTimeout(r, 500));
            }

            if (perfilData) {
                // Atualizar para admin se não for
                if (perfilData.funcao !== 'admin') {
                    const { error: updateError } = await supabase
                        .from('perfis')
                        .update({ funcao: 'admin', email: email, nome_completo: 'Administrador' })
                        .eq('id', data.user.id);

                    if (updateError) {
                        console.error('Erro ao atualizar perfil admin:', updateError);
                    }
                }
            } else {
                // Criar perfil admin se não existir
                const { error: insertError } = await supabase
                    .from('perfis')
                    .insert({
                        id: data.user.id,
                        email: email,
                        nome_completo: 'Administrador',
                        funcao: 'admin'
                    });

                if (insertError) {
                    console.error('Erro ao criar perfil admin:', insertError);
                    // Tentar atualizar se já existir
                    await supabase
                        .from('perfis')
                        .update({ funcao: 'admin', email: email, nome_completo: 'Administrador' })
                        .eq('id', data.user.id);
                }
            }
        }

        Toast.fire({ icon: 'success', title: 'Login realizado com sucesso' });
        await verificarUsuario();
    }
});

// Cadastro (EMAIL)
document.getElementById('formulario-cadastro').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('cad-email').value.trim();
    const senha = document.getElementById('cad-senha').value;

    const metaData = {
        nome_completo: document.getElementById('cad-nome').value,
        cpf: document.getElementById('cad-cpf').value,
        data_nascimento: document.getElementById('cad-nasc').value,
        tag: document.getElementById('cad-tag').value
    };

    Swal.fire({
        title: 'Criando conta...',
        text: 'Aguarde...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    const { data, error } = await supabase.auth.signUp({
        email: email,
        password: senha,
        options: {
            data: metaData
        }
    });

    Swal.close();

    if (error) {
        let msg = error.message;
        if (msg.includes('already registered')) msg = 'Este email já está cadastrado.';
        mostrarErro('Erro no Cadastro', msg);
        return;
    }

    if (data.user) {
        if (data.session) {
            mostrarSucesso('Conta criada com sucesso!');
            await verificarUsuario();
        } else {
            Swal.fire({
                icon: 'info',
                title: 'Conta Criada',
                text: 'Você já pode fazer login!'
            }).then(() => navegarPara('login'));
        }
    }
});

// --- Programações para Apontamento (select de OS) ---
async function carregarProgramacoesParaApontamento() {
    const selectOS = document.getElementById('apt-ordem-select');
    const selectUnidade = document.getElementById('apt-unidade');
    if (!selectOS || !selectUnidade) return;

    let og = selectUnidade.querySelector('optgroup[label="Setores programados"]');
    if (!og) {
        og = document.createElement('optgroup');
        og.label = 'Setores programados';
        selectUnidade.appendChild(og);
    }
    og.innerHTML = '';

    const { data: prog, error } = await supabase
        .from('programacoes')
        .select('*')
        .eq('id_colaborador', estado.usuario?.id)
        .order('data_programada', { ascending: false });

    estado.programacoesUsuario = prog || [];
    const setoresUnicos = [...new Set((prog || []).map(p => p.setor_unidade).filter(Boolean))];

    // Popular select de OS
    selectOS.innerHTML = '<option value="">Selecione uma OS programada...</option>';
    estado.programacoesUsuario.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.os_numero;
        opt.textContent = `OS #${p.os_numero} - ${p.setor_unidade || ''}`;
        opt.dataset.problema = p.problema || '';
        opt.dataset.setor = p.setor_unidade || '';
        selectOS.appendChild(opt);
    });
    const optOutra = document.createElement('option');
    optOutra.value = '__outra__';
    optOutra.textContent = 'Digitar outra OS';
    selectOS.appendChild(optOutra);

    // Adicionar setores das programações ao select unidade
    setoresUnicos.forEach(s => {
        if (!selectUnidade.querySelector(`option[value="${s}"]`)) {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            if (og) og.appendChild(opt);
        }
    });

    mostrarOcultarAptOrdemManual();
}

function mostrarOcultarAptOrdemManual() {
    const selectOS = document.getElementById('apt-ordem-select');
    const manualInput = document.getElementById('apt-ordem-manual');
    if (!selectOS || !manualInput) return;
    const isOutra = selectOS.value === '__outra__';
    manualInput.classList.toggle('oculto', !isOutra);
    manualInput.required = isOutra;
    selectOS.required = !isOutra;
    if (!isOutra) manualInput.value = '';
}

function obterOrdemApt() {
    const selectOS = document.getElementById('apt-ordem-select');
    const manualInput = document.getElementById('apt-ordem-manual');
    if (!selectOS || !manualInput) return '';
    if (selectOS.value === '__outra__') return manualInput.value?.trim() || '';
    return selectOS.value || '';
}

document.getElementById('apt-ordem-select')?.addEventListener('change', function () {
    const val = this.value;
    const manualInput = document.getElementById('apt-ordem-manual');
    const aptDesc = document.getElementById('apt-desc');
    const aptUnidade = document.getElementById('apt-unidade');

    mostrarOcultarAptOrdemManual();

    if (val === '__outra__' || val === '') {
        if (aptDesc) aptDesc.value = '';
        if (aptUnidade) aptUnidade.value = '';
        if (manualInput) manualInput.focus();
    } else {
        const opt = this.selectedOptions[0];
        if (opt && aptDesc) aptDesc.value = opt.dataset.problema || '';
        if (opt && aptUnidade) aptUnidade.value = opt.dataset.setor || '';
    }
});

// --- Carregar Usuários (Manutentor Dropdown) ---
async function carregarUsuarios() {
    const select = document.getElementById('apt-manutentor');
    if (!select) return;

    const { data, error } = await supabase
        .from('perfis')
        .select('id, nome_completo')
        .order('nome_completo');

    if (data) {
        estado.usuarios = data;
        select.innerHTML = '<option value="">Selecione o Manutentor...</option>';
        data.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.nome_completo;
            select.appendChild(option);
        });
        // Preencher manutentor com o usuário logado (cadastro do cliente)
        if (estado.usuario?.id && data.some(u => u.id === estado.usuario.id)) {
            select.value = estado.usuario.id;
        }
        // Preencher centro de trabalho com o departamento do perfil (tag do cadastro)
        const aptCentro = document.getElementById('apt-centro');
        if (aptCentro && estado.perfil?.tag) {
            const tag = estado.perfil.tag;
            if ([...aptCentro.options].some(o => o.value === tag)) {
                aptCentro.value = tag;
            }
        }
    } else {
        select.innerHTML = '<option value="">Erro ao carregar</option>';
    }
}

// --- Edição de Apontamentos ---

let apontamentoEditando = null;

async function abrirEdicaoApontamento(apt) {
    apontamentoEditando = apt;
    navegarPara('dashboard');
    await carregarProgramacoesParaApontamento();
    atualizarVisibilidadeCamposAdmin();

    const selectOS = document.getElementById('apt-ordem-select');
    const manualInput = document.getElementById('apt-ordem-manual');
    const temNaProg = estado.programacoesUsuario?.some(p => p.os_numero === apt.numero_ordem);
    if (temNaProg && selectOS) {
        selectOS.value = apt.numero_ordem;
    } else {
        if (selectOS) selectOS.value = '__outra__';
        if (manualInput) manualInput.value = apt.numero_ordem;
    }
    mostrarOcultarAptOrdemManual();
    document.getElementById('apt-desc').value = apt.descricao;
    document.getElementById('apt-unidade').value = apt.unidade;
    document.getElementById('apt-centro').value = apt.centro_trabalho;
    document.getElementById('apt-data').value = apt.data_servico;
    document.getElementById('apt-inicio').value = apt.hora_inicio;
    document.getElementById('apt-fim').value = apt.hora_fim;
    document.getElementById('apt-check').checked = apt.concluido;
    document.getElementById('apt-obs').value = apt.observacoes || '';

    // Conforme planejado (botões Sim/Não) e justificativa
    atualizarVisibilidadeCamposAdmin(apt.conforme_planejado);
    const campoJustificativa = document.getElementById('apt-justificativa');
    if (campoJustificativa) campoJustificativa.value = apt.justificativa || '';

    // Selecionar manutentor
    await carregarUsuarios();
    document.getElementById('apt-manutentor').value = apt.id_manutentor;

    // Mudar título e botão
    document.querySelector('#tela-dashboard h2').textContent = 'Editar Apontamento';
    const btnSubmit = document.querySelector('#formulario-apontamento button[type="submit"]');
    btnSubmit.innerHTML = '<i data-lucide="save"></i> ATUALIZAR APONTAMENTO';
    btnSubmit.dataset.modo = 'editar';

    // Scroll para o topo
    window.scrollTo(0, 0);
    lucide.createIcons();
}

// Modificar o submit do formulário para suportar edição
const formAptOriginal = document.getElementById('formulario-apontamento');
const handlerOriginal = formAptOriginal.onsubmit;
formAptOriginal.onsubmit = null;

document.getElementById('formulario-apontamento').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!estado.usuario) return;

    const btn = e.target.querySelector('button[type="submit"]');
    const isEdicao = btn.dataset.modo === 'editar' && apontamentoEditando;
    const textoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = isEdicao ? 'Atualizando...' : 'Processando...';

    try {
        const ordem = obterOrdemApt();
        if (!ordem) {
            throw new Error('Selecione uma OS programada ou digite o número manualmente.');
        }
        let desc = (document.getElementById('apt-desc').value || '').trim();
        const unidade = document.getElementById('apt-unidade').value;
        const idManutentor = document.getElementById('apt-manutentor').value;
        const centro = document.getElementById('apt-centro').value;
        const dataServico = document.getElementById('apt-data').value;
        const inicio = document.getElementById('apt-inicio').value;
        const fim = document.getElementById('apt-fim').value;
        const concluido = document.getElementById('apt-check').checked;
        const obs = document.getElementById('apt-obs').value;

        // Conforme planejado: valor do hidden (sim/nao) ou botões
        const conformeVal = document.getElementById('apt-conforme-planejado')?.value || '';
        const conformePlanejado = conformeVal === 'sim';
        if (conformeVal !== 'sim' && conformeVal !== 'nao') {
            throw new Error('Informe se foi conforme planejado (clique em Sim ou Não).');
        }
        const justificativa = !conformePlanejado ? document.getElementById('apt-justificativa').value?.trim() : null;

        if (!idManutentor) {
            throw new Error('Selecione um manutentor.');
        }

        if (!conformePlanejado && !justificativa) {
            throw new Error('Quando não foi conforme planejado, a justificativa é obrigatória.');
        }

        // Descrição: obrigatória só quando Não; quando Sim pode ficar em branco
        if (!conformePlanejado && !desc) {
            throw new Error('Informe a descrição da atividade.');
        }
        if (conformePlanejado && !desc) desc = 'Conforme planejado';

        let urlsFotos = apontamentoEditando?.fotos || [];

        // Upload de novas fotos apenas se houver
        const inputArquivos = document.getElementById('apt-arquivos');
        const arquivos = Array.from(inputArquivos.files);
        if (arquivos.length > 0) {
            for (let i = 0; i < arquivos.length; i++) {
                btn.innerHTML = `Enviando ${i + 1}/${arquivos.length}...`;
                const arquivo = arquivos[i];
                const nomeLimpo = arquivo.name.replace(/[^a-zA-Z0-9.]/g, '_');
                const caminho = `${estado.usuario.id}/${Date.now()}_${nomeLimpo}`;

                const { error: uploadError } = await supabase.storage
                    .from('fotos_apontamentos')
                    .upload(caminho, arquivo);

                if (uploadError) throw new Error('Falha no upload: ' + uploadError.message);

                const { data: urlData } = supabase.storage
                    .from('fotos_apontamentos')
                    .getPublicUrl(caminho);

                if (urlData) urlsFotos.push(urlData.publicUrl);
            }
        }

        btn.innerHTML = isEdicao ? 'Salvando alterações...' : 'Salvando dados...';

        if (isEdicao) {
            // Atualizar
            const dadosUpdate = {
                id_manutentor: idManutentor,
                numero_ordem: ordem,
                descricao: desc,
                unidade: unidade,
                centro_trabalho: centro,
                data_servico: dataServico,
                hora_inicio: inicio,
                hora_fim: fim,
                concluido: concluido,
                observacoes: obs,
                fotos: urlsFotos,
                conforme_planejado: conformePlanejado,
                justificativa: justificativa || null
            };

            const { error: updateError } = await supabase
                .from('apontamentos')
                .update(dadosUpdate)
                .eq('id', apontamentoEditando.id);

            if (updateError) throw new Error(updateError.message);
            mostrarSucesso('Apontamento Atualizado!');
        } else {
            // Inserir novo
            const dadosInsert = {
                id_usuario: estado.usuario.id,
                id_manutentor: idManutentor,
                numero_ordem: ordem,
                descricao: desc,
                unidade: unidade,
                centro_trabalho: centro,
                data_servico: dataServico,
                hora_inicio: inicio,
                hora_fim: fim,
                concluido: concluido,
                observacoes: obs,
                fotos: urlsFotos,
                conforme_planejado: conformePlanejado,
                justificativa: justificativa || null
            };

            const { error: insertError } = await supabase.from('apontamentos').insert([dadosInsert]);

            if (insertError) throw new Error(insertError.message);
            mostrarSucesso('Apontamento Salvo!');
        }

        e.target.reset();
        apontamentoEditando = null;
        document.querySelector('#tela-dashboard h2').textContent = 'Registrar Serviço';
        btn.innerHTML = '<i data-lucide="check-circle"></i> SALVAR APONTAMENTO';
        btn.dataset.modo = '';
        navegarPara('menu');

    } catch (erro) {
        mostrarErro('Ops!', erro.message);
    } finally {
        btn.disabled = false;
        lucide.createIcons();
    }
});

// --- Listagens ---

let buscaHistorico = '';

async function carregarHistorico() {
    const lista = document.getElementById('lista-historico');
    lista.innerHTML = '<div class="centro">Carregando...</div>';

    let query = supabase
        .from('apontamentos')
        .select(`
            *,
            manutentor:id_manutentor(nome_completo)
        `)
        .eq('id_usuario', estado.usuario.id)
        .order('criado_em', { ascending: false });

    // Aplicar busca se houver
    if (buscaHistorico) {
        query = query.ilike('numero_ordem', `%${buscaHistorico}%`);
    }

    const { data, error } = await query;

    if (error) {
        lista.innerHTML = '<p class="centro erro">Erro ao carregar dados.</p>';
        return;
    }

    renderizarLogs(data, lista);
}

// Busca no histórico
document.getElementById('busca-historico').addEventListener('input', (e) => {
    buscaHistorico = e.target.value.trim();
    carregarHistorico();
});

let filtrosAdmin = {
    unidade: '',
    centro: '',
    dataInicio: '',
    dataFim: ''
};

async function carregarDadosAdmin() {
    const lista = document.getElementById('lista-admin');
    const listaUsuarios = document.getElementById('lista-usuarios-admin');

    lista.innerHTML = '<div class="centro">Carregando...</div>';
    listaUsuarios.innerHTML = '<div class="centro">Carregando...</div>';

    // Carregar usuários
    const { data: usuariosData, error: usuariosError } = await supabase
        .from('perfis')
        .select('id, nome_completo, email, tag, funcao, criado_em')
        .order('nome_completo');

    if (usuariosData) {
        listaUsuarios.innerHTML = '';
        if (usuariosData.length === 0) {
            listaUsuarios.innerHTML = '<p style="color: #666;">Nenhum usuário cadastrado.</p>';
        } else {
            usuariosData.forEach((user, index) => {
                const div = document.createElement('div');
                div.className = 'item-lista accordion-item';
                div.style.marginBottom = '0.75rem';
                const accordionId = `user-accordion-${user.id}-${index}`;
                const dataCadastro = user.criado_em ? new Date(user.criado_em).toLocaleDateString('pt-BR') : 'N/A';
                div.innerHTML = `
                    <button class="accordion-header" onclick="toggleAccordion('${accordionId}')">
                        <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                                <i data-lucide="chevron-down" class="accordion-icon" id="icon-${accordionId}" style="width:20px; height:20px; transition:transform 0.3s;"></i>
                                <span style="font-weight:600;">${user.nome_completo || 'Sem nome'}</span>
                                <span class="badge ${user.funcao === 'admin' ? 'badge-ok' : 'badge-wait'}" style="font-size:0.75rem; padding:2px 8px;">
                                    ${user.funcao === 'admin' ? 'ADMIN' : 'USUÁRIO'}
                                </span>
                            </div>
                        </div>
                    </button>
                    <div class="accordion-content" id="${accordionId}">
                        <div style="padding-top: 1rem;">
                            <p style="font-size:0.85rem; color:#666; margin-bottom:4px;">
                                <i data-lucide="mail" style="width:14px; height:14px; vertical-align:middle;"></i> 
                                <strong>Email:</strong> ${user.email || 'N/A'}
                            </p>
                            ${user.tag ? `<p style="font-size:0.85rem; color:#666; margin-bottom:4px;">
                                <i data-lucide="briefcase" style="width:14px; height:14px; vertical-align:middle;"></i> 
                                <strong>Departamento:</strong> ${user.tag}
                            </p>` : ''}
                            <p style="font-size:0.85rem; color:#666; margin-bottom:1rem;">
                                <i data-lucide="calendar" style="width:14px; height:14px; vertical-align:middle;"></i> 
                                <strong>Cadastrado em:</strong> ${dataCadastro}
                            </p>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 1rem;">
                                <button class="btn btn-secundario" style="font-size: 0.85rem; padding: 0.5rem; height: auto;" onclick="editarBancoHoras('${user.id}')">
                                    <i data-lucide="clock" style="width:14px; height:14px;"></i> Banco de Horas
                                </button>
                                <button class="btn btn-secundario" style="font-size: 0.85rem; padding: 0.5rem; height: auto;" onclick="editarFerias('${user.id}')">
                                    <i data-lucide="calendar" style="width:14px; height:14px;"></i> Férias
                                </button>
                            </div>
                        </div>
                    </div>
                `;
                listaUsuarios.appendChild(div);
            });
            lucide.createIcons();
        }
    }

    // Carregar apontamentos com filtros
    let query = supabase
        .from('apontamentos')
        .select(`
            *,
            manutentor:id_manutentor(nome_completo),
            usuario:id_usuario(nome_completo)
        `)
        .order('criado_em', { ascending: false });

    if (filtrosAdmin.unidade) {
        query = query.eq('unidade', filtrosAdmin.unidade);
    }
    if (filtrosAdmin.centro) {
        query = query.eq('centro_trabalho', filtrosAdmin.centro);
    }
    if (filtrosAdmin.dataInicio) {
        query = query.gte('data_servico', filtrosAdmin.dataInicio);
    }
    if (filtrosAdmin.dataFim) {
        query = query.lte('data_servico', filtrosAdmin.dataFim);
    }

    const { data, error } = await query;

    if (error) {
        lista.innerHTML = '<p class="centro">Acesso restrito ou erro de conexão.</p>';
        return;
    }

    renderizarLogs(data, lista, true);
}

// Event listeners para filtros admin
document.getElementById('btn-aplicar-filtros').addEventListener('click', () => {
    filtrosAdmin = {
        unidade: document.getElementById('filtro-unidade').value,
        centro: document.getElementById('filtro-centro').value,
        dataInicio: document.getElementById('filtro-data-inicio').value,
        dataFim: document.getElementById('filtro-data-fim').value
    };
    carregarDadosAdmin();
});

document.getElementById('btn-limpar-filtros').addEventListener('click', () => {
    filtrosAdmin = { unidade: '', centro: '', dataInicio: '', dataFim: '' };
    document.getElementById('filtro-unidade').value = '';
    document.getElementById('filtro-centro').value = '';
    document.getElementById('filtro-data-inicio').value = '';
    document.getElementById('filtro-data-fim').value = '';
    carregarDadosAdmin();
});

function renderizarLogs(logs, conteiner, isAdmin = false) {
    conteiner.innerHTML = '';

    if (!logs || logs.length === 0) {
        conteiner.innerHTML = `
            <div class="card centro" style="padding: 3rem 1rem;">
                <i data-lucide="clipboard-x" style="width: 48px; height: 48px; color: #ccc; margin-bottom: 10px;"></i>
                <p style="color: #666;">Nenhum apontamento encontrado.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    logs.forEach((log, index) => {
        const dataFormatada = new Date(log.data_servico).toLocaleDateString('pt-BR');
        const dataHoraCriado = log.criado_em ? new Date(log.criado_em).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : 'N/A';
        const nomeManutentor = log.manutentor?.nome_completo || 'N/A';
        const nomeUsuario = log.usuario?.nome_completo || 'N/A';

        // Verificar se o usuário pode editar (é dono do apontamento ou é admin)
        const podeEditar = isAdmin || (log.id_usuario === estado.usuario?.id);

        let htmlFotos = '';
        if (log.fotos && log.fotos.length > 0) {
            htmlFotos = `<div class="imgs-galeria">`;
            log.fotos.forEach(url => {
                htmlFotos += `<a href="${url}" target="_blank"><img src="${url}" class="thumb-img"></a>`;
            });
            htmlFotos += `</div>`;
        }

        const div = document.createElement('div');
        div.className = `item-lista accordion-item ${log.concluido ? 'concluido' : 'pendente'}`;
        const accordionId = `accordion-${log.id}-${index}`;
        div.innerHTML = `
            <button class="accordion-header" onclick="toggleAccordion('${accordionId}')">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <div style="display:flex; align-items:center; gap:10px; flex:1;">
                        <i data-lucide="chevron-down" class="accordion-icon" id="icon-${accordionId}" style="width:20px; height:20px; transition:transform 0.3s;"></i>
                        <span style="font-weight:800; color:var(--cor-primaria);"># ${log.numero_ordem}</span>
                        <span style="font-size:0.9rem; color:#666; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">
                            ${log.descricao.length > 40 ? log.descricao.substring(0, 40) + '...' : log.descricao}
                        </span>
                    </div>
                    <div style="display:flex; gap:10px; align-items:center; flex-shrink:0;">
                        <span class="badge ${log.concluido ? 'badge-ok' : 'badge-wait'}">
                            ${log.concluido ? 'CONCLUÍDO' : 'PENDENTE'}
                        </span>
                    </div>
                </div>
            </button>
            <div class="accordion-content" id="${accordionId}">
                <div style="font-size: 0.95rem; color: #444; padding-top: 1rem;">
                    ${podeEditar ? `<div style="display:flex; justify-content:flex-end; margin-bottom:10px;">
                        <button class="btn-editar-apt" data-id="${log.id}" onclick="event.stopPropagation();" style="background:none; border:none; cursor:pointer; padding:5px; color:var(--cor-primaria); display:flex; align-items:center; gap:5px;" title="Editar">
                            <i data-lucide="edit-2" style="width:18px; height:18px;"></i>
                            <span style="font-size:0.85rem;">Editar</span>
                        </button>
                    </div>` : ''}
                    <p style="margin-bottom:4px;"><strong>${log.descricao}</strong></p>
                    <p style="font-size:0.85rem; color:#666;">
                        <i data-lucide="map-pin" style="width:14px; height:14px; vertical-align:middle;"></i> 
                        ${log.unidade} • ${log.centro_trabalho}
                    </p>
                    <p style="font-size:0.85rem; color:#666; margin-top:4px;">
                        <i data-lucide="calendar" style="width:14px; height:14px; vertical-align:middle;"></i> 
                        ${dataFormatada} • ${log.hora_inicio} às ${log.hora_fim}
                    </p>
                    ${isAdmin ? `<p style="font-size:0.85rem; color:#666; margin-top:4px;">
                        <i data-lucide="clock" style="width:14px; height:14px; vertical-align:middle;"></i> 
                        Apontado em: ${dataHoraCriado}
                    </p>` : ''}
                    <p style="margin-top:5px; font-weight:600; color:#004175;">
                        <i data-lucide="user" style="width:14px; height:14px; vertical-align:middle;"></i> 
                        Manutentor: ${nomeManutentor}
                    </p>
                    ${isAdmin ? `<p style="margin-top:3px; font-size:0.85rem; color:#666;">Criado por: ${nomeUsuario}</p>` : ''}
                    ${log.observacoes ? `<p style="margin-top:8px; font-size:0.9rem; font-style:italic; color:#555;">Obs: ${log.observacoes}</p>` : ''}
                    ${isAdmin && log.conforme_planejado === true ? `<div style="margin-top:12px; padding:10px; background:#d1fae5; border-left:4px solid #10b981; border-radius:6px;">
                        <p style="margin:0; font-weight:600; color:#065f46; font-size:0.9rem;">
                            <i data-lucide="check-circle" style="width:16px; height:16px; vertical-align:middle;"></i> 
                            Foi conforme planejado: <span style="color:#059669;">Sim</span>
                        </p>
                    </div>` : ''}
                    ${isAdmin && log.conforme_planejado === false ? `<div style="margin-top:12px; padding:10px; background:#fee2e2; border-left:4px solid #ef4444; border-radius:6px;">
                        <p style="margin:0 0 6px 0; font-weight:600; color:#991b1b; font-size:0.9rem;">
                            <i data-lucide="x-circle" style="width:16px; height:16px; vertical-align:middle;"></i> 
                            Foi conforme planejado: <span style="color:#dc2626;">Não</span>
                        </p>
                        ${log.justificativa ? `<p style="margin:0; font-size:0.85rem; color:#7f1d1d; padding-left:20px;">
                            <strong>Justificativa:</strong> ${(log.justificativa || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
                        </p>` : ''}
                    </div>` : ''}
                    ${htmlFotos}
                </div>
            </div>
        `;
        conteiner.appendChild(div);

        // Adicionar listener para edição (usuários podem editar seus próprios apontamentos, admins podem editar todos)
        const btnEditar = div.querySelector('.btn-editar-apt');
        if (btnEditar) {
            btnEditar.style.display = 'none'; // Inicialmente oculto
            btnEditar.addEventListener('click', (e) => {
                e.stopPropagation();
                abrirEdicaoApontamento(log);
            });

            // Mostrar/esconder botão quando acordeão abrir/fechar
            const content = div.querySelector('.accordion-content');
            const observer = new MutationObserver(() => {
                if (content.classList.contains('active')) {
                    btnEditar.style.display = 'flex';
                } else {
                    btnEditar.style.display = 'none';
                }
            });
            observer.observe(content, { attributes: true, attributeFilter: ['class'] });
        }
    });
    lucide.createIcons();
}

// Função global para toggle do acordeão
window.toggleAccordion = function (id) {
    const content = document.getElementById(id);
    const icon = document.getElementById(`icon-${id}`);

    if (content.classList.contains('active')) {
        content.classList.remove('active');
        if (icon) {
            icon.style.transform = 'rotate(0deg)';
        }
    } else {
        // Fechar outros acordeões abertos no mesmo container
        const container = content.closest('.tela');
        if (container) {
            container.querySelectorAll('.accordion-content.active').forEach(item => {
                if (item.id !== id) {
                    item.classList.remove('active');
                    const otherIcon = document.getElementById(`icon-${item.id}`);
                    if (otherIcon) {
                        otherIcon.style.transform = 'rotate(0deg)';
                    }
                }
            });
        }

        content.classList.add('active');
        if (icon) {
            icon.style.transform = 'rotate(180deg)';
        }
    }
};

// Excel Export (Enhanced)
document.getElementById('btn-exportar-excel').addEventListener('click', async () => {
    Swal.fire({
        title: 'Gerando Relatório...',
        didOpen: () => Swal.showLoading()
    });

    const { data } = await supabase
        .from('apontamentos')
        .select(`
            *,
            manutentor:id_manutentor(nome_completo),
            usuario:id_usuario(nome_completo)
        `);

    if (data) {
        const dadosFormatados = data.map(item => ({
            'Ordem': item.numero_ordem || '',
            'Descrição': item.descricao || '',
            'Unidade': item.unidade || '',
            'Centro de Trabalho': item.centro_trabalho || '',
            'Manutentor': item.manutentor?.nome_completo || 'N/A',
            'Criado Por': item.usuario?.nome_completo || 'N/A',
            'Data': item.data_servico ? new Date(item.data_servico).toLocaleDateString('pt-BR') : '',
            'Hora Início': item.hora_inicio || '',
            'Hora Fim': item.hora_fim || '',
            'Status': item.concluido ? 'Concluído' : 'Pendente',
            'Observações': item.observacoes || '',
            'Fotos': item.fotos?.length || 0,
            'Conforme Planejado': item.conforme_planejado === true ? 'Sim' : item.conforme_planejado === false ? 'Não' : 'N/A',
            'Justificativa': item.justificativa || ''
        }));

        const ws = XLSX.utils.json_to_sheet(dadosFormatados);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Apontamentos_MCL");
        XLSX.writeFile(wb, `Relatorio_MCL_${new Date().toISOString().split('T')[0]}.xlsx`);

        Swal.close();
        Toast.fire({ icon: 'success', title: 'Relatório baixado!' });
    } else {
        Swal.close();
        mostrarErro('Erro', 'Não foi possível gerar o relatório.');
    }
});

// --- Setores (para Programação) ---
const SETORES = [
    '11101 MT CENTRAL', '11102 MT F.DESENV.', '11103 MT RATES', '11104 MT RESIDEN', '11105 MT ADM.PESSOAL',
    '11106 MT ADM.GERAL', '11107 MT TAREFEIROS', '11108 MT CONTABILIDADE', '11109 MT INFORMÁTICA', '11110 MT SERV.GERAIS',
    '11111 MT REFEITÓRIO', '11112 MT PIS/COFINS', '11113 MT MED S. TRAB', '11114 MT SER ELET', '11115 MT DH',
    '11201 MT RECURSOS', '11202 MT CRÉD/REPASS', '11301 MT INSUMOS', '11302 MT TSI', '11303 MT AG PRECISÃO',
    '11304 MT INSUMOS II', '11305 MT INSUMOS LOG', '11401 MT ENGENHARIA', '11402 MT EQUIPE ADM', '11501 MT MARKETING',
    '11601 MT ADM LOG', '11602 MT TRANSPORT', '11603 MT ASSIST. TEC.', '11604 MT P. HOUSE', '11605 MT ENERGIA',
    '11606 MT IND SUCOS', '11607 MT TRIBUTÁRIO', '11608 MT AUDITORIA GRC', '12101 MT AG ADM', '12102 MT AG MANUT',
    '12103 MT ALMOX CORPR', '12104 MT AG LOG', '12201 MT AG COM', '12202 MT AG COM COOP', '12203 MT AG COM TERC',
    '12204 MT AG ADQ COOP', '12205 MT AG ADQ TERC', '12301 MT AG UBC', '12302 MT AG UBS', '12401 MT AG ARM. ALG',
    '12402 MT AG UBA I', '12403 MT AG UBA II', '13101 MT DIPER ADM', '13201 MT DIPER COMFR', '13202 MT DIPER LOGFR',
    '13301 MT DIPER COMFL', '13302 MT DIPER LOGFL', '14101 MT CITR ADM', '14201 MT CITR COOP', '14202 MT CITR TERC',
    '14203 MT CITR LOG', '21101 TAQ ADM', '21201 TAQ PROD COOP', '21202 TAQ PROD TERC', '21203 TAQ ADQ COOP',
    '21204 TAQ ADQ TERC', '21205 TAQ UBC', '21301 TAQ INSUMOS', '21304 TAQ INSUMOS II', '21305 TAQ INSUMOS LOG',
    '31101 TAK ADM', '31102 TAK PROD COOP', '31103 TAK PROD TERC', '31104 TAK ADQ COOP', '31105 TAK ADQ TERC',
    '31106 TAK UBC', '31107 TAK UBS', '31108 TAK CITRUS', '31109 TAK LOG', '41101 AV ADM', '41201 AV PROD COOP',
    '41202 AV PROD TERC', '41203 AV ADQ COOP', '41204 AV ADQ TERC', '41205 AV UBC', '41301 AV INSUMOS',
    '41304 AV INSUMOS II', '41305 AV INSUMOS LOG', '51101 TQRI ADM', '51201 TQRI PROD COOP', '51202 TQRI PROD TERC',
    '51203 TQRI ADQ COOP', '51301 TQRI UBC', '51302 TQRI LOG', '61301 ITABE INSUMOS', '61305 ITABE INSU LOG',
    '71101 S.MANU ADM', '71201 S.M PROD COOP', '71202 S.M PROD TERC', '71205 S.MANU UBC', '71301 S.MANU INSUMOS',
    '71302 S.MANU RAÇÃO', '71303 S.M REVENDA RAÇÃO', '71305 S.MANU LOG', '81101 TQRITUBA ADM', '81201 TQBA PROD COOP',
    '81202 TQBA PROD TERC', '81205 TQBA UBC', '81301 TQBA INSUMOS', '81305 TQBA SUP LOG', '91101 ITA II ADM',
    '91102 TRANSPORTE CBT', '91201 ITA II COM CP', '91202 ITA II COM TER', '91205 ITA II UBC', '91301 ITA II SUP',
    '91304 ITA INSUMOS II', '91305 ITA II SUP LOG', '101301 ITAPE SUP', '101304 ITAPE SUP II', '101305 ITAPE SUP LOG'
];

// Departamentos / Centros de trabalho para programação de OS
const DEPARTAMENTOS = ['Elétrica', 'Mecânica', 'Automação'];

// --- Programações ---
async function carregarProgramacoesAdmin() {
    if (estado.perfil?.funcao !== 'admin') return;
    const lista = document.getElementById('lista-programacoes-admin');
    if (!lista) return;
    lista.innerHTML = '<div class="centro" style="padding: 2rem;">Carregando...</div>';

    await carregarUsuarios();
    const { data: prog, error } = await supabase
        .from('programacoes')
        .select('*')
        .order('criado_em', { ascending: false });

    if (error) {
        lista.innerHTML = `<div class="card centro" style="padding: 2rem; color: #991b1b;">${error.message?.includes('does not exist') ? 'Tabela programacoes não encontrada. Execute supabase_setup_programacoes.sql' : error.message}</div>`;
        lucide.createIcons();
        return;
    }

    lista.innerHTML = '';
    if (!prog || prog.length === 0) {
        lista.innerHTML = '<div class="card centro" style="padding: 3rem 1rem;"><p style="color: #666;">Nenhuma programação. Clique em + para criar.</p></div>';
        lucide.createIcons();
        return;
    }

    prog.forEach(p => {
        const card = document.createElement('div');
        card.className = 'card card-programacao';
        const nomeColab = estado.usuarios?.find(u => u.id === p.id_colaborador)?.nome_completo || '—';
        const dataFmt = p.data_programada ? new Date(p.data_programada + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                    <span style="font-weight:700; color:var(--cor-primaria); font-size:1.1rem;">OS #${p.os_numero}</span>
                    <span style="font-size:0.85rem; color:#666; margin-left:0.5rem;">${dataFmt}</span>
                </div>
                <button class="btn btn-outline btn-sm btn-excluir-prog" data-id="${p.id}" title="Excluir"><i data-lucide="trash-2"></i></button>
            </div>
            <div class="prog-linha">
                <div class="prog-item"><span>Colaborador</span><strong>${nomeColab}</strong></div>
                <div class="prog-item"><span>Setor/Unidade</span><strong>${p.setor_unidade || '—'}</strong></div>
            </div>
            <div class="prog-problema">${(p.problema || '—').replace(/</g, '&lt;')}</div>
        `;
        lista.appendChild(card);
    });
    lista.querySelectorAll('.btn-excluir-prog').forEach(btn => {
        btn.addEventListener('click', () => excluirProgramacao(btn.dataset.id));
    });
    lucide.createIcons();
}

async function carregarProgramacaoDiaria() {
    const lista = document.getElementById('lista-programacao-usuario');
    if (!lista) return;
    lista.innerHTML = '<div class="centro" style="padding: 2rem;">Carregando...</div>';

    const { data: prog, error } = await supabase
        .from('programacoes')
        .select('*')
        .eq('id_colaborador', estado.usuario?.id)
        .order('data_programada', { ascending: false });

    if (error) {
        lista.innerHTML = `<div class="card centro" style="padding: 2rem; color: #991b1b;">${error.message?.includes('does not exist') ? 'Execute supabase_setup_programacoes.sql' : error.message}</div>`;
        lucide.createIcons();
        return;
    }

    lista.innerHTML = '';
    if (!prog || prog.length === 0) {
        lista.innerHTML = '<div class="card centro" style="padding: 3rem 1rem;"><p style="color: #666;">Nenhuma programação para você hoje.</p></div>';
        lucide.createIcons();
        return;
    }

    prog.forEach(p => {
        const card = document.createElement('div');
        card.className = 'card card-programacao card-programacao-diaria';
        const dataFmt = p.data_programada ? new Date(p.data_programada + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }) : '—';
        card.innerHTML = `
            <div class="prog-header">
                <div class="prog-os-badge">OS #${p.os_numero}</div>
                <span class="prog-data">${dataFmt}</span>
            </div>
            <div class="prog-linha">
                <div class="prog-item"><span>Setor/Unidade</span><strong>${p.setor_unidade || '—'}</strong></div>
            </div>
            <div class="prog-problema">${(p.problema || '—').replace(/</g, '&lt;')}</div>
            <button type="button" class="btn btn-primario btn-sm prog-btn-apontar" data-os="${p.os_numero}" title="Apontar esta OS">
                <i data-lucide="edit-3"></i> Apontar
            </button>
        `;
        lista.appendChild(card);
    });
    lista.querySelectorAll('.prog-btn-apontar').forEach(btn => {
        btn.addEventListener('click', () => {
            const os = btn.dataset.os;
            navegarPara('dashboard');
            carregarProgramacoesParaApontamento().then(() => {
                const select = document.getElementById('apt-ordem-select');
                if (select && os) {
                    select.value = os;
                    select.dispatchEvent(new Event('change'));
                }
                mostrarOcultarAptOrdemManual();
            });
        });
    });
    lucide.createIcons();
}

document.getElementById('btn-nova-programacao')?.addEventListener('click', async () => {
    if (estado.perfil?.funcao !== 'admin') return;
    await carregarUsuarios();

    const optsColab = estado.usuarios
        .filter(u => u.funcao !== 'admin')
        .map(u => `<option value="${u.id}">${u.nome_completo || '—'}</option>`)
        .join('');
    const optsSetor = SETORES.map(s => `<option value="${s}">${s}</option>`).join('');
    const optsDepartamento = DEPARTAMENTOS.map(d => `<option value="${d}">${d}</option>`).join('');
    const hoje = new Date().toISOString().slice(0, 10);

    const { value: form } = await Swal.fire({
        title: 'Nova programação',
        html: `
            <div style="text-align:left;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Data programada</label>
                <input type="date" id="swal-data" class="swal2-input" value="${hoje}" style="margin-bottom:1rem;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">OS nº</label>
                <input id="swal-os" class="swal2-input" placeholder="Ex: 12345" style="margin-bottom:1rem;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Colaborador</label>
                <select id="swal-colab" class="swal2-input" style="margin-bottom:1rem;">${optsColab || '<option value="">Nenhum colaborador</option>'}</select>
                <label style="display:block;margin-bottom:4px;font-weight:600;">Setor/Unidade</label>
                <select id="swal-setor" class="swal2-input" style="margin-bottom:1rem;">${optsSetor}</select>
                <label style="display:block;margin-bottom:4px;font-weight:600;">Departamento (Elétrica / Mecânica / Automação)</label>
                <select id="swal-departamento" class="swal2-input" style="margin-bottom:1rem;">${optsDepartamento}</select>
                <label style="display:block;margin-bottom:4px;font-weight:600;">Problema</label>
                <textarea id="swal-problema" class="swal2-textarea" rows="3" placeholder="Descreva o problema..."></textarea>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#004175',
        preConfirm: () => {
            const data_programada = document.getElementById('swal-data').value || hoje;
            const os_numero = document.getElementById('swal-os').value?.trim() || '';
            const id_colaborador = document.getElementById('swal-colab').value || '';
            const setor = document.getElementById('swal-setor').value || '';
            const departamento = document.getElementById('swal-departamento').value || '';
            const problema = document.getElementById('swal-problema').value?.trim() || '';

            // Guarda o departamento junto com o setor, para aparecer na listagem e na programação diária
            const setor_unidade = departamento ? `${departamento} - ${setor}` : setor;

            return {
                data_programada,
                os_numero,
                id_colaborador,
                setor_unidade,
                problema
            };
        }
    });

    if (form && form.os_numero && form.id_colaborador && form.setor_unidade && form.problema) {
        try {
            const { error } = await supabase.from('programacoes').insert([{
                data_programada: form.data_programada,
                os_numero: form.os_numero,
                id_colaborador: form.id_colaborador,
                setor_unidade: form.setor_unidade,
                problema: form.problema
            }]);
            if (error) throw error;
            mostrarSucesso('Programação criada!');
            carregarProgramacoesAdmin();
        } catch (e) {
            mostrarErro('Erro', e.message || 'Não foi possível salvar.');
        }
    }
});

async function excluirProgramacao(id) {
    if (estado.perfil?.funcao !== 'admin') return;
    const { value: ok } = await Swal.fire({
        title: 'Excluir programação?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Excluir'
    });
    if (ok) {
        try {
            const { error } = await supabase.from('programacoes').delete().eq('id', id);
            if (error) throw error;
            mostrarSucesso('Programação excluída!');
            carregarProgramacoesAdmin();
        } catch (e) {
            mostrarErro('Erro', e.message || 'Não foi possível excluir.');
        }
    }
}

// --- Veículos ---
async function carregarVeiculos() {
    const lista = document.getElementById('lista-veiculos');
    const btnAdicionar = document.getElementById('btn-adicionar-veiculo');
    if (!lista) return;

    const isAdmin = estado.perfil?.funcao === 'admin';
    if (btnAdicionar) btnAdicionar.classList.toggle('oculto', !isAdmin);

    lista.innerHTML = '<div class="centro" style="padding: 2rem;">Carregando...</div>';

    const { data: veiculos, error } = await supabase
        .from('veiculos')
        .select('*')
        .order('placa');

    if (error) {
        lista.innerHTML = `<div class="card centro" style="padding: 2rem; color: #991b1b;">${error.message?.includes('does not exist') ? 'Tabela veiculos não encontrada. Execute supabase_setup_veiculos.sql' : error.message}</div>`;
        lucide.createIcons();
        return;
    }

    lista.innerHTML = '';
    if (!veiculos || veiculos.length === 0) {
        lista.innerHTML = '<div class="card centro" style="padding: 3rem 1rem;"><p style="color: #666;">Nenhum veículo cadastrado.</p></div>';
        lucide.createIcons();
        return;
    }

    const formatarDataBR = (iso) => {
        if (!iso) return '—';
        const d = new Date(iso + 'T12:00:00');
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('pt-BR');
    };

    veiculos.forEach(v => {
        const card = document.createElement('div');
        card.className = 'card card-veiculo';
        const placaFormatada = formatarPlaca(v.placa);
        const fotoUrl = v.foto ? v.foto.replace(/"/g, '&quot;') : '';
        const docUrl = v.documento ? v.documento.replace(/"/g, '&quot;') : '';
        card.innerHTML = `
            <div class="veiculo-foto img-expansivel" ${fotoUrl ? `data-img-url="${fotoUrl}"` : ''} title="Clique para ampliar">
                ${v.foto ? `<img src="${v.foto}" alt="Foto do veículo" onerror="this.parentElement.innerHTML='<div class=\\'foto-placeholder\\'><i data-lucide=\\'car\\'></i> Sem foto</div>'">` : '<div class="foto-placeholder"><i data-lucide="car"></i> Sem foto</div>'}
            </div>
            <div class="placa-moldura">${placaFormatada}</div>
            <div class="veiculo-lavagem">
                <div class="lavagem-item"><span>Última lavagem</span><strong>${formatarDataBR(v.ultima_lavagem)}</strong></div>
                <div class="lavagem-item"><span>Próxima lavagem</span><strong>${formatarDataBR(v.proxima_lavagem)}</strong></div>
            </div>
            <div class="veiculo-documento ${docUrl ? 'img-expansivel' : ''}" ${docUrl ? `data-img-url="${docUrl}" title="Clique para ampliar"` : ''}>
                ${v.documento ? `<img src="${v.documento}" alt="Foto do documento" class="doc-thumb" onerror="this.parentElement.innerHTML='<span style=\\'color:#999;font-size:0.85rem\\'>Sem documento</span>'">` : '<span style="color:#999;font-size:0.85rem;">Sem documento</span>'}
            </div>
            ${isAdmin ? `<div class="veiculo-acoes">
                <button class="btn btn-outline btn-sm btn-editar-veiculo" data-id="${v.id}" title="Editar"><i data-lucide="edit-2"></i></button>
                <button class="btn btn-outline btn-sm btn-excluir-veiculo" data-id="${v.id}" title="Excluir"><i data-lucide="trash-2"></i></button>
            </div>` : ''}
        `;
        lista.appendChild(card);
    });

    lista.querySelectorAll('.img-expansivel[data-img-url]').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
            const url = el.dataset.imgUrl;
            if (url) expandirImagem(url);
        });
    });
    lista.querySelectorAll('.btn-excluir-veiculo').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); excluirVeiculo(btn.dataset.id); });
    });
    lista.querySelectorAll('.btn-editar-veiculo').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); editarVeiculo(btn.dataset.id); });
    });
    lucide.createIcons();
}

function formatarPlaca(placa) {
    if (!placa) return '—';
    const p = String(placa).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (p.length >= 7) return `${p.slice(0, 3)}-${p.slice(3, 7)}`;
    return placa.toUpperCase();
}

function expandirImagem(url) {
    Swal.fire({
        html: `<img src="${url}" alt="Imagem ampliada" style="max-width:100%; max-height:80vh; border-radius:8px;">`,
        showConfirmButton: false,
        background: 'rgba(0,0,0,0.9)',
        customClass: { popup: 'swal-lightbox' },
        didOpen: () => {
            document.querySelector('.swal-lightbox').style.cursor = 'zoom-out';
            document.querySelector('.swal-lightbox').addEventListener('click', () => Swal.close());
        }
    });
}

document.getElementById('btn-adicionar-veiculo')?.addEventListener('click', async () => {
    if (estado.perfil?.funcao !== 'admin') return;

    const { value: form } = await Swal.fire({
        title: 'Adicionar veículo',
        html: `
            <div style="text-align:left;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Placa</label>
                <input id="swal-placa" class="swal2-input" placeholder="ABC1D23" style="margin-bottom:1rem; text-transform: uppercase;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Foto do veículo</label>
                <input id="swal-foto-file" class="swal2-input" type="file" accept="image/*" style="margin-bottom:1rem; padding:8px;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Foto do documento</label>
                <input id="swal-doc-file" class="swal2-input" type="file" accept="image/*" style="margin-bottom:1rem; padding:8px;">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 0.5rem;">
                    <div>
                        <label style="display:block;margin-bottom:4px;font-weight:600;">Última lavagem</label>
                        <input id="swal-ultima" class="swal2-input" type="date" style="margin:0;">
                    </div>
                    <div>
                        <label style="display:block;margin-bottom:4px;font-weight:600;">Próxima lavagem</label>
                        <input id="swal-proxima" class="swal2-input" type="date" style="margin:0;">
                    </div>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#004175',
        preConfirm: async () => {
            const placa = document.getElementById('swal-placa').value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || '';
            const fotoInput = document.getElementById('swal-foto-file');
            const docInput = document.getElementById('swal-doc-file');
            const ultima = document.getElementById('swal-ultima').value || '';
            const proxima = document.getElementById('swal-proxima').value || '';

            if (!placa || placa.length < 7) {
                Swal.showValidationMessage('Informe uma placa válida (ex: ABC1D23).');
                return false;
            }
            if (!fotoInput?.files?.[0]) {
                Swal.showValidationMessage('Envie a foto do veículo.');
                return false;
            }
            if (!docInput?.files?.[0]) {
                Swal.showValidationMessage('Envie a foto do documento.');
                return false;
            }
            if (!ultima || !proxima) {
                Swal.showValidationMessage('Preencha as datas de última e próxima lavagem.');
                return false;
            }

            let fotoUrl = null, docUrl = null;
            const uploadFile = async (file, prefix) => {
                const ext = file.name.split('.').pop() || 'jpg';
                const path = `veiculos/${Date.now()}_${prefix}_${placa || 'img'}.${ext}`;
                const { error } = await supabase.storage.from('fotos_apontamentos').upload(path, file);
                if (error) throw error;
                const { data } = supabase.storage.from('fotos_apontamentos').getPublicUrl(path);
                return data?.publicUrl || null;
            };
            try {
                if (fotoInput?.files?.[0]) fotoUrl = await uploadFile(fotoInput.files[0], 'veiculo');
                if (docInput?.files?.[0]) docUrl = await uploadFile(docInput.files[0], 'doc');
            } catch (e) {
                Swal.showValidationMessage('Erro ao enviar: ' + (e.message || 'tente novamente'));
                return false;
            }
            return { placa, foto: fotoUrl, documento: docUrl, ultima_lavagem: ultima, proxima_lavagem: proxima };
        }
    });

    if (form && form.placa.length >= 7) {
        try {
            const { error } = await supabase.from('veiculos').insert([{
                placa: form.placa,
                foto: form.foto,
                documento: form.documento,
                ultima_lavagem: form.ultima_lavagem,
                proxima_lavagem: form.proxima_lavagem
            }]);
            if (error) throw error;
            mostrarSucesso('Veículo adicionado!');
            carregarVeiculos();
        } catch (err) {
            mostrarErro('Erro', err.message || 'Não foi possível salvar.');
        }
    }
});

async function editarVeiculo(id) {
    if (estado.perfil?.funcao !== 'admin') return;

    const { data: veiculo, error } = await supabase.from('veiculos').select('*').eq('id', id).single();
    if (error || !veiculo) {
        mostrarErro('Erro', 'Não foi possível carregar o veículo.');
        return;
    }

    const { value: form } = await Swal.fire({
        title: 'Editar veículo',
        html: `
            <div style="text-align:left;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Placa</label>
                <input id="swal-placa" class="swal2-input" value="${(veiculo.placa || '').replace(/"/g, '&quot;')}" style="margin-bottom:1rem; text-transform: uppercase;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Trocar foto do veículo (opcional)</label>
                <input id="swal-foto-file" class="swal2-input" type="file" accept="image/*" style="margin-bottom:1rem; padding:8px;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Trocar foto do documento (opcional)</label>
                <input id="swal-doc-file" class="swal2-input" type="file" accept="image/*" style="margin-bottom:1rem; padding:8px;">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 0.5rem;">
                    <div>
                        <label style="display:block;margin-bottom:4px;font-weight:600;">Última lavagem</label>
                        <input id="swal-ultima" class="swal2-input" type="date" value="${veiculo.ultima_lavagem || ''}" style="margin:0;">
                    </div>
                    <div>
                        <label style="display:block;margin-bottom:4px;font-weight:600;">Próxima lavagem</label>
                        <input id="swal-proxima" class="swal2-input" type="date" value="${veiculo.proxima_lavagem || ''}" style="margin:0;">
                    </div>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#004175',
        preConfirm: async () => {
            const placa = document.getElementById('swal-placa').value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || '';
            const fotoInput = document.getElementById('swal-foto-file');
            const docInput = document.getElementById('swal-doc-file');
            const ultima = document.getElementById('swal-ultima').value || '';
            const proxima = document.getElementById('swal-proxima').value || '';

            if (!placa || placa.length < 7) {
                Swal.showValidationMessage('Informe uma placa válida (ex: ABC1D23).');
                return false;
            }
            if (!ultima || !proxima) {
                Swal.showValidationMessage('Preencha as datas de última e próxima lavagem.');
                return false;
            }

            let fotoUrl = veiculo.foto || null;
            let docUrl = veiculo.documento || null;
            const uploadFile = async (file, prefix) => {
                const ext = file.name.split('.').pop() || 'jpg';
                const path = `veiculos/${Date.now()}_${prefix}_${placa || 'img'}.${ext}`;
                const { error } = await supabase.storage.from('fotos_apontamentos').upload(path, file);
                if (error) throw error;
                const { data } = supabase.storage.from('fotos_apontamentos').getPublicUrl(path);
                return data?.publicUrl || null;
            };
            try {
                if (fotoInput?.files?.[0]) fotoUrl = await uploadFile(fotoInput.files[0], 'veiculo');
                if (docInput?.files?.[0]) docUrl = await uploadFile(docInput.files[0], 'doc');
            } catch (e) {
                Swal.showValidationMessage('Erro ao enviar: ' + (e.message || 'tente novamente'));
                return false;
            }

            return { placa, foto: fotoUrl, documento: docUrl, ultima_lavagem: ultima, proxima_lavagem: proxima };
        }
    });

    if (form) {
        try {
            const { error: upErr } = await supabase
                .from('veiculos')
                .update({
                    placa: form.placa,
                    foto: form.foto,
                    documento: form.documento,
                    ultima_lavagem: form.ultima_lavagem,
                    proxima_lavagem: form.proxima_lavagem
                })
                .eq('id', id);
            if (upErr) throw upErr;
            mostrarSucesso('Veículo atualizado!');
            carregarVeiculos();
        } catch (e) {
            mostrarErro('Erro', e.message || 'Não foi possível atualizar.');
        }
    }
}

async function excluirVeiculo(id) {
    if (estado.perfil?.funcao !== 'admin') return;
    const { value: ok } = await Swal.fire({
        title: 'Excluir veículo?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Excluir'
    });
    if (ok) {
        try {
            const { error } = await supabase.from('veiculos').delete().eq('id', id);
            if (error) throw error;
            mostrarSucesso('Veículo excluído!');
            carregarVeiculos();
        } catch (err) {
            mostrarErro('Erro', err.message || 'Não foi possível excluir.');
        }
    }
}

// --- Funções para Banco de Horas, Hora Extra e Férias ---

async function carregarBancoHoras() {
    const lista = document.getElementById('lista-banco-horas');
    lista.innerHTML = '<div class="centro">Carregando...</div>';

    const usuarioLogadoId = estado.usuario?.id;
    if (!usuarioLogadoId) {
        lista.innerHTML = '<p class="centro">Faça login para ver seu banco de horas.</p>';
        return;
    }

    // Buscar horas do usuário logado
    const { data: horasUsuario, error: errorHoras } = await supabase
        .from('horas_usuarios')
        .select('*')
        .eq('id_usuario', usuarioLogadoId)
        .single();

    if (errorHoras && errorHoras.code !== 'PGRST116') {
        lista.innerHTML = '<p class="centro">Erro ao carregar banco de horas.</p>';
        return;
    }

    const nomeUsuario = estado.perfil?.nome_completo || 'Você';

    const usuario = {
        id: usuarioLogadoId,
        nome: nomeUsuario,
        horasPositivas: parseFloat(horasUsuario?.horas_positivas || 0),
        horasNegativas: parseFloat(horasUsuario?.horas_negativas || 0),
        horasExtras: parseFloat(horasUsuario?.horas_extras || 0),
        horasExtrasFimSemana: parseFloat(horasUsuario?.horas_extras_fim_semana || 0),
        total: (parseFloat(horasUsuario?.horas_positivas || 0) - parseFloat(horasUsuario?.horas_negativas || 0))
    };

    const isAdmin = estado.perfil?.funcao === 'admin';

    lista.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
            <h3 style="margin: 0; color: var(--cor-primaria); font-size: 1.1rem; flex: 1; min-width: 200px;">${usuario.nome} <span style="font-size:0.8rem; color:#666;">(Seu saldo)</span></h3>
                ${isAdmin ? `<button class="btn btn-secundario" style="width: auto; min-width: 120px; padding: 0.5rem 1rem; font-size: 0.85rem; display: flex; align-items: center; gap: 0.5rem;" onclick="editarBancoHoras('${usuario.id}')">
                    <i data-lucide="edit-2" style="width:16px; height:16px;"></i> Editar
                </button>` : ''}
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                <div style="padding: 1rem; background: #d1fae5; border-radius: 8px;">
                    <div style="font-size: 0.85rem; color: #065f46; margin-bottom: 5px;">Horas Positivas</div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: #065f46;">+${usuario.horasPositivas.toFixed(2)}h</div>
                </div>
                <div style="padding: 1rem; background: #fee2e2; border-radius: 8px;">
                    <div style="font-size: 0.85rem; color: #991b1b; margin-bottom: 5px;">Horas Negativas</div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: #991b1b;">-${usuario.horasNegativas.toFixed(2)}h</div>
                </div>
            </div>
            <div style="padding: 1rem; background: #dbeafe; border-radius: 8px; margin-bottom: 1rem;">
                <div style="font-size: 0.85rem; color: #1e40af; margin-bottom: 5px;">Total Banco de Horas</div>
                <div style="font-size: 1.8rem; font-weight: 700; color: #1e40af;">${usuario.total >= 0 ? '+' : ''}${usuario.total.toFixed(2)}h</div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div style="padding: 0.75rem; background: #fef3c7; border-radius: 8px;">
                    <div style="font-size: 0.8rem; color: #92400e; margin-bottom: 3px;">Hora Extra Total</div>
                    <div style="font-size: 1.2rem; font-weight: 600; color: #92400e;">${usuario.horasExtras.toFixed(2)}h</div>
                </div>
                <div style="padding: 0.75rem; background: #fce7f3; border-radius: 8px;">
                    <div style="font-size: 0.8rem; color: #9f1239; margin-bottom: 3px;">Hora Extra Fim de Semana</div>
                    <div style="font-size: 1.2rem; font-weight: 600; color: #9f1239;">${usuario.horasExtrasFimSemana.toFixed(2)}h</div>
                </div>
            </div>
        `;
    lista.appendChild(card);
    lucide.createIcons();
}

const DIAS_SEMANA = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];

function formatarDiaComSemana(dataStr) {
    if (!dataStr) return '';
    const d = new Date(dataStr + 'T12:00:00');
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const diaSemana = DIAS_SEMANA[d.getDay()];
    return `${dia}/${mes} - ${diaSemana}`;
}

let escalaOrdenacao = { col: 'dia', asc: true };

async function carregarHoraExtra() {
    const tbody = document.getElementById('tbody-hora-extra');
    const emptyDiv = document.getElementById('lista-hora-extra-empty');
    const btnAdicionar = document.getElementById('btn-adicionar-escala');
    const thAcoes = document.querySelector('.tabela-escala .th-acoes');

    const isAdmin = estado.perfil?.funcao === 'admin';
    if (btnAdicionar) btnAdicionar.classList.toggle('oculto', !isAdmin);
    if (thAcoes) thAcoes.classList.toggle('oculto', !isAdmin);
    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('oculto', !isAdmin));

    tbody.innerHTML = '<tr><td colspan="5" class="centro" style="padding: 2rem;">Carregando...</td></tr>';
    emptyDiv.style.display = 'none';

    const { data: linhas, error } = await supabase
        .from('escala_hora_extra')
        .select('*')
        .order('dia', { ascending: true });

    if (error) {
        const tabelaErr = document.querySelector('.tabela-escala');
        if (tabelaErr) tabelaErr.style.display = 'table';
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="centro" style="padding: 2rem; color: #991b1b;">${error.message.includes('does not exist') ? 'Tabela escala_hora_extra não encontrada. Execute o SQL em supabase_setup_escala.sql' : error.message}</td></tr>`;
        if (emptyDiv) emptyDiv.style.display = 'none';
        lucide.createIcons();
        return;
    }

    let itens = linhas || [];
    itens.sort((a, b) => {
        let va = a[escalaOrdenacao.col], vb = b[escalaOrdenacao.col];
        if (escalaOrdenacao.col === 'dia' || escalaOrdenacao.col === 'folga') {
            va = va || '';
            vb = vb || '';
        }
        const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
        return escalaOrdenacao.asc ? cmp : -cmp;
    });

    tbody.innerHTML = '';

    const tabelaEl = document.querySelector('.tabela-escala');
    if (itens.length === 0) {
        if (isAdmin) {
            // Admin: manter tabela visível com estrutura vazia para poder adicionar
            if (tabelaEl) tabelaEl.style.display = 'table';
            if (emptyDiv) emptyDiv.style.display = 'none';
            tbody.innerHTML = `<tr><td colspan="5" class="centro" style="padding: 2rem; color: #666;">Nenhum registro na escala. Clique em "Adicionar" para inserir.</td></tr>`;
        } else {
            if (tabelaEl) tabelaEl.style.display = 'none';
            if (emptyDiv) emptyDiv.style.display = 'block';
        }
        lucide.createIcons();
        return;
    }

    if (tabelaEl) tabelaEl.style.display = 'table';
    itens.forEach((item, idx) => {
        const tr = document.createElement('tr');
        const acoesHtml = isAdmin ? `
            <td class="td-acoes">
                <button class="btn-editar-linha" data-id="${item.id}" title="Editar"><i data-lucide="edit-2" style="width:14px;height:14px;"></i></button>
                <button class="btn-excluir-linha" data-id="${item.id}" title="Excluir"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
            </td>
        ` : '';
        tr.innerHTML = `
            <td>${item.horario || '07:00/17:00'}</td>
            <td>${item.colaborador || ''}</td>
            <td>${formatarDiaComSemana(item.dia)}</td>
            <td class="col-folga">${formatarDiaComSemana(item.folga)}</td>
            ${acoesHtml}
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-editar-linha').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            editarLinhaEscala(btn.dataset.id);
        });
    });
    tbody.querySelectorAll('.btn-excluir-linha').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            excluirLinhaEscala(btn.dataset.id);
        });
    });

    lucide.createIcons();
}

document.getElementById('btn-adicionar-escala')?.addEventListener('click', () => adicionarLinhaEscala());

// Botão "Informações da Escala" - texto completo das orientações
const TEXTO_INFO_ESCALA = `Boa tarde pessoal, como alinhamos segue a escala de hora extra para os final de semana. Também já está alinhada a questão das refeições. Enfatizo que sobre o restante da escala de elétrica será alinhado.

🕒 Horário:
Das 07h00 às 17h00 (sábado e domingo).

🏭 Atuação:
Atendimentos corretivos mecânicos e elétricos na unidade Takaoka, UBC, Avaré.

🍽 Refeições:
Café da manhã e almoço confirmados para ambos os dias.

⚠ Pontos Importantes:

- O foco é atendimento corretivo.

- Caso solicitem melhorias ou qualquer atividade fora do escopo corretivo, me acionem antes para validação.

- Não realizar atendimentos de urgência sem abertura prévia de OS. Mesmo sendo urgente, precisa estar formalizado antes da execução.`;

document.getElementById('btn-info-escala')?.addEventListener('click', () => {
    Swal.fire({
        title: 'Informações da Escala de Hora Extra',
        html: `<div style="text-align: left; font-size: 0.95rem; line-height: 1.7; white-space: pre-wrap; max-height: 70vh; overflow-y: auto;">${TEXTO_INFO_ESCALA.replace(/\n/g, '<br>')}</div>`,
        width: '90%',
        maxWidth: 520,
        confirmButtonText: 'Fechar',
        confirmButtonColor: '#004175',
        customClass: { popup: 'swal-info-escala' }
    });
    lucide.createIcons();
});

async function adicionarLinhaEscala(colaboradorPreenchido = '') {
    if (estado.perfil?.funcao !== 'admin') return;

    const { value: form } = await Swal.fire({
        title: 'Adicionar registro na escala',
        html: `
            <div style="text-align:left;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Horário</label>
                <input id="swal-horario" class="swal2-input" value="07:00/17:00" placeholder="07:00/17:00" style="margin-bottom:1rem;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Colaborador(es)</label>
                <input id="swal-colaborador" class="swal2-input" value="${(colaboradorPreenchido || '').replace(/"/g, '&quot;')}" placeholder="NOME E NOME" style="margin-bottom:1rem;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Dia</label>
                <input id="swal-dia" class="swal2-input" type="date" style="margin-bottom:1rem;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Folga</label>
                <input id="swal-folga" class="swal2-input" type="date">
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#004175',
        preConfirm: () => ({
            horario: document.getElementById('swal-horario').value || '07:00/17:00',
            colaborador: document.getElementById('swal-colaborador').value || '',
            dia: document.getElementById('swal-dia').value || '',
            folga: document.getElementById('swal-folga').value || ''
        })
    });

    if (form && form.dia && form.folga && form.colaborador) {
        try {
            const { error } = await supabase.from('escala_hora_extra').insert([form]);
            if (error) throw error;
            mostrarSucesso('Registro adicionado!');
            carregarHoraExtra();
        } catch (err) {
            mostrarErro('Erro', err.message || 'Não foi possível salvar.');
        }
    }
}

async function editarLinhaEscala(id) {
    if (estado.perfil?.funcao !== 'admin') return;

    const { data: item } = await supabase.from('escala_hora_extra').select('*').eq('id', id).single();
    if (!item) return;

    const { value: form } = await Swal.fire({
        title: 'Editar registro',
        html: `
            <div style="text-align:left;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Horário</label>
                <input id="swal-horario" class="swal2-input" value="${item.horario || '07:00/17:00'}" style="margin-bottom:1rem;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Colaborador(es)</label>
                <input id="swal-colaborador" class="swal2-input" value="${item.colaborador || ''}" style="margin-bottom:1rem;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Dia</label>
                <input id="swal-dia" class="swal2-input" type="date" value="${item.dia || ''}" style="margin-bottom:1rem;">
                <label style="display:block;margin-bottom:4px;font-weight:600;">Folga</label>
                <input id="swal-folga" class="swal2-input" type="date" value="${item.folga || ''}">
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#004175',
        preConfirm: () => ({
            horario: document.getElementById('swal-horario').value || '07:00/17:00',
            colaborador: document.getElementById('swal-colaborador').value || '',
            dia: document.getElementById('swal-dia').value || '',
            folga: document.getElementById('swal-folga').value || ''
        })
    });

    if (form && form.dia && form.folga && form.colaborador) {
        try {
            const { error } = await supabase.from('escala_hora_extra').update(form).eq('id', id);
            if (error) throw error;
            mostrarSucesso('Registro atualizado!');
            carregarHoraExtra();
        } catch (err) {
            mostrarErro('Erro', err.message || 'Não foi possível salvar.');
        }
    }
}

async function excluirLinhaEscala(id) {
    if (estado.perfil?.funcao !== 'admin') return;
    const { value: ok } = await Swal.fire({
        title: 'Excluir registro?',
        text: 'Esta ação não pode ser desfeita.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Excluir'
    });
    if (ok) {
        try {
            const { error } = await supabase.from('escala_hora_extra').delete().eq('id', id);
            if (error) throw error;
            mostrarSucesso('Registro excluído!');
            carregarHoraExtra();
        } catch (err) {
            mostrarErro('Erro', err.message || 'Não foi possível excluir.');
        }
    }
}

// Ordenação da tabela de escala (clicar no header)
document.querySelectorAll('.tabela-escala th[data-col]')?.forEach(th => {
    th.addEventListener('click', () => {
        const col = th.dataset.col;
        escalaOrdenacao.asc = escalaOrdenacao.col === col ? !escalaOrdenacao.asc : true;
        escalaOrdenacao.col = col;
        carregarHoraExtra();
    });
});

async function carregarFerias() {
    const lista = document.getElementById('lista-ferias');
    lista.innerHTML = '<div class="centro">Carregando...</div>';

    // Garantir que usuários estejam carregados
    if (estado.usuarios.length === 0) {
        await carregarUsuarios();
    }

    // Buscar todos os usuários
    const { data: usuarios, error: errorUsuarios } = await supabase
        .from('perfis')
        .select('id, nome_completo')
        .order('nome_completo');

    if (errorUsuarios) {
        lista.innerHTML = '<p class="centro">Erro ao carregar dados.</p>';
        return;
    }

    // Buscar férias salvas no banco
    const { data: horasSalvas, error: errorHoras } = await supabase
        .from('horas_usuarios')
        .select('id_usuario, ferias');

    // Ordenar (usuário logado primeiro)
    let usuariosArray = [...usuarios];
    const usuarioLogadoId = estado.usuario?.id;

    usuariosArray.sort((a, b) => {
        if (a.id === usuarioLogadoId) return -1;
        if (b.id === usuarioLogadoId) return 1;
        return a.nome_completo.localeCompare(b.nome_completo);
    });

    // Renderizar
    lista.innerHTML = '';
    if (usuariosArray.length === 0) {
        lista.innerHTML = '<div class="card centro" style="padding: 3rem 1rem;"><p style="color: #666;">Nenhum usuário encontrado.</p></div>';
        return;
    }

    usuariosArray.forEach(usuario => {
        const card = document.createElement('div');
        card.className = 'card';
        const isUsuarioLogado = usuario.id === usuarioLogadoId;
        card.style.border = isUsuarioLogado ? '2px solid var(--cor-primaria)' : '';
        card.style.backgroundColor = isUsuarioLogado ? '#f0f7ff' : '';

        const isAdmin = estado.perfil?.funcao === 'admin';

        // Buscar férias do usuário
        const horasUsuario = horasSalvas?.find(h => h.id_usuario === usuario.id);
        let feriasArray = [];
        try {
            if (horasUsuario?.ferias) {
                feriasArray = JSON.parse(horasUsuario.ferias);
            }
        } catch (e) {
            feriasArray = [];
        }

        const feriasHTML = feriasArray.length > 0
            ? feriasArray.map(f => `<div style="padding: 0.5rem; background: #f0f7ff; border-radius: 6px; margin-bottom: 0.5rem; font-size: 0.9rem;">
                <strong>${f.inicio || 'N/A'}</strong> até <strong>${f.fim || 'N/A'}</strong>
            </div>`).join('')
            : '<p style="color: #999; font-size: 0.9rem;">Nenhum período de férias cadastrado.</p>';

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                <h3 style="margin: 0; color: var(--cor-primaria); font-size: 1.1rem; flex: 1; min-width: 200px;">${usuario.nome_completo}${isUsuarioLogado ? ' <span style="font-size:0.8rem; color:#666;">(Você)</span>' : ''}</h3>
                ${isAdmin ? `<button class="btn btn-secundario" style="width: auto; min-width: 120px; padding: 0.5rem 1rem; font-size: 0.85rem; display: flex; align-items: center; gap: 0.5rem;" onclick="editarFerias('${usuario.id}')">
                    <i data-lucide="edit-2" style="width:16px; height:16px;"></i> Editar
                </button>` : ''}
            </div>
            <div style="padding: 1rem; background: #f9fafb; border-radius: 8px;">
                ${feriasHTML}
            </div>
        `;
        lista.appendChild(card);
    });
    lucide.createIcons();
}

// Funções auxiliares para buscar e salvar horas
async function buscarHorasUsuario(userId) {
    const { data, error } = await supabase
        .from('horas_usuarios')
        .select('*')
        .eq('id_usuario', userId)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('Erro ao buscar horas:', error);
        return null;
    }

    return data || {
        id_usuario: userId,
        horas_positivas: 0,
        horas_negativas: 0,
        horas_extras: 0,
        horas_extras_fim_semana: 0,
        ferias: null
    };
}

async function salvarHorasUsuario(userId, dados) {
    const { data, error } = await supabase
        .from('horas_usuarios')
        .upsert({
            id_usuario: userId,
            horas_positivas: parseFloat(dados.horas_positivas) || 0,
            horas_negativas: parseFloat(dados.horas_negativas) || 0,
            horas_extras: parseFloat(dados.horas_extras) || 0,
            horas_extras_fim_semana: parseFloat(dados.horas_extras_fim_semana) || 0,
            ferias: dados.ferias || null,
            atualizado_em: new Date().toISOString()
        }, {
            onConflict: 'id_usuario'
        });

    if (error) {
        console.error('Erro ao salvar horas:', error);
        throw error;
    }

    return data;
}

// Funções de edição para admins (apenas nas novas telas)
window.editarBancoHoras = async function (userId) {
    if (estado.perfil?.funcao !== 'admin') {
        mostrarErro('Acesso Restrito', 'Apenas administradores podem editar essas informações.');
        return;
    }

    // Buscar dados atuais
    const horasAtuais = await buscarHorasUsuario(userId);

    // Buscar nome do usuário
    let usuario = estado.usuarios.find(u => u.id === userId);
    if (!usuario) {
        const { data: perfilData } = await supabase
            .from('perfis')
            .select('nome_completo')
            .eq('id', userId)
            .single();
        usuario = { nome_completo: perfilData?.nome_completo || 'Usuário' };
    }

    const { value: formValues } = await Swal.fire({
        title: `Editar Banco de Horas - ${usuario.nome_completo}`,
        html: `
            <div style="text-align: left; margin: 1rem 0;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #065f46;">Horas Positivas:</label>
                <input id="swal-horas-positivas" class="swal2-input" type="number" step="0.01" value="${horasAtuais.horas_positivas || 0}" placeholder="0.00" style="margin-bottom: 1rem;">
                
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #991b1b;">Horas Negativas:</label>
                <input id="swal-horas-negativas" class="swal2-input" type="number" step="0.01" value="${horasAtuais.horas_negativas || 0}" placeholder="0.00" style="margin-bottom: 1rem;">
                
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #92400e;">Hora Extra Total:</label>
                <input id="swal-horas-extras" class="swal2-input" type="number" step="0.01" value="${horasAtuais.horas_extras || 0}" placeholder="0.00" style="margin-bottom: 1rem;">
                
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #9f1239;">Hora Extra Fim de Semana:</label>
                <input id="swal-horas-extras-fs" class="swal2-input" type="number" step="0.01" value="${horasAtuais.horas_extras_fim_semana || 0}" placeholder="0.00">
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#004175',
        preConfirm: () => {
            return {
                horas_positivas: document.getElementById('swal-horas-positivas').value,
                horas_negativas: document.getElementById('swal-horas-negativas').value,
                horas_extras: document.getElementById('swal-horas-extras').value,
                horas_extras_fim_semana: document.getElementById('swal-horas-extras-fs').value,
                ferias: horasAtuais.ferias
            };
        }
    });

    if (formValues) {
        try {
            Swal.fire({
                title: 'Salvando...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            await salvarHorasUsuario(userId, formValues);

            Swal.close();
            mostrarSucesso('Banco de Horas atualizado!');
            carregarBancoHoras();
        } catch (error) {
            Swal.close();
            mostrarErro('Erro', 'Não foi possível salvar as alterações.');
        }
    }
};

window.editarHoraExtra = async function (userId) {
    if (estado.perfil?.funcao !== 'admin') {
        mostrarErro('Acesso Restrito', 'Apenas administradores podem editar essas informações.');
        return;
    }

    // Buscar dados atuais
    const horasAtuais = await buscarHorasUsuario(userId);

    // Buscar nome do usuário
    let usuario = estado.usuarios.find(u => u.id === userId);
    if (!usuario) {
        const { data: perfilData } = await supabase
            .from('perfis')
            .select('nome_completo')
            .eq('id', userId)
            .single();
        usuario = { nome_completo: perfilData?.nome_completo || 'Usuário' };
    }

    const { value: formValues } = await Swal.fire({
        title: `Editar Hora Extra - ${usuario.nome_completo}`,
        html: `
            <div style="text-align: left; margin: 1rem 0;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #92400e;">Total Hora Extra:</label>
                <input id="swal-he-total" class="swal2-input" type="number" step="0.01" value="${horasAtuais.horas_extras || 0}" placeholder="0.00" style="margin-bottom: 1rem;">
                
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #9f1239;">Hora Extra Fim de Semana:</label>
                <input id="swal-he-fs" class="swal2-input" type="number" step="0.01" value="${horasAtuais.horas_extras_fim_semana || 0}" placeholder="0.00">
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#004175',
        preConfirm: () => {
            return {
                horas_positivas: horasAtuais.horas_positivas || 0,
                horas_negativas: horasAtuais.horas_negativas || 0,
                horas_extras: document.getElementById('swal-he-total').value,
                horas_extras_fim_semana: document.getElementById('swal-he-fs').value,
                ferias: horasAtuais.ferias
            };
        }
    });

    if (formValues) {
        try {
            Swal.fire({
                title: 'Salvando...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            await salvarHorasUsuario(userId, formValues);

            Swal.close();
            mostrarSucesso('Hora Extra atualizada!');
            carregarHoraExtra();
        } catch (error) {
            Swal.close();
            mostrarErro('Erro', 'Não foi possível salvar as alterações.');
        }
    }
};

window.editarFerias = async function (userId) {
    if (estado.perfil?.funcao !== 'admin') {
        mostrarErro('Acesso Restrito', 'Apenas administradores podem editar essas informações.');
        return;
    }

    // Buscar dados atuais
    const horasAtuais = await buscarHorasUsuario(userId);

    // Buscar nome do usuário
    let usuario = estado.usuarios.find(u => u.id === userId);
    if (!usuario) {
        const { data: perfilData } = await supabase
            .from('perfis')
            .select('nome_completo')
            .eq('id', userId)
            .single();
        usuario = { nome_completo: perfilData?.nome_completo || 'Usuário' };
    }

    // Parsear férias (JSON array)
    let feriasArray = [];
    try {
        if (horasAtuais.ferias) {
            feriasArray = JSON.parse(horasAtuais.ferias);
        }
    } catch (e) {
        feriasArray = [];
    }

    const feriasTexto = feriasArray.map((f, i) => {
        const inicio = f.inicio || '';
        const fim = f.fim || '';
        return `${i + 1}. ${inicio} até ${fim}`;
    }).join('\n') || '';

    const { value: formValues } = await Swal.fire({
        title: `Editar Férias - ${usuario.nome_completo}`,
        html: `
            <div style="text-align: left; margin: 1rem 0;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Períodos de Férias:</label>
                <p style="font-size: 0.85rem; color: #666; margin-bottom: 0.5rem;">Formato: uma linha por período (ex: 01/01/2024 até 31/01/2024)</p>
                <textarea id="swal-ferias" class="swal2-textarea" rows="5" placeholder="01/01/2024 até 31/01/2024&#10;01/07/2024 até 31/07/2024">${feriasTexto}</textarea>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#004175',
        preConfirm: () => {
            const texto = document.getElementById('swal-ferias').value;
            const linhas = texto.split('\n').filter(l => l.trim());
            const ferias = linhas.map(linha => {
                const partes = linha.split(' até ');
                return {
                    inicio: partes[0]?.trim() || '',
                    fim: partes[1]?.trim() || ''
                };
            });

            return {
                horas_positivas: horasAtuais.horas_positivas || 0,
                horas_negativas: horasAtuais.horas_negativas || 0,
                horas_extras: horasAtuais.horas_extras || 0,
                horas_extras_fim_semana: horasAtuais.horas_extras_fim_semana || 0,
                ferias: JSON.stringify(ferias)
            };
        }
    });

    if (formValues) {
        try {
            Swal.fire({
                title: 'Salvando...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            await salvarHorasUsuario(userId, formValues);

            Swal.close();
            mostrarSucesso('Férias atualizadas!');
            carregarFerias();
        } catch (error) {
            Swal.close();
            mostrarErro('Erro', 'Não foi possível salvar as alterações.');
        }
    }
};

// Inicializar
verificarUsuario();
