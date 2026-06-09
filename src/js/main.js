
import { supabase } from './supabase.js';

const estado = {
    usuario: null,
    perfil: null,
    usuarios: [],
    programacoesUsuario: [],
    realtimeChannelOS: null,
    /** @type {Map<string, { id: string, nome: string }[]> | null} */
    equipamentosExtrasMap: null,
    /** @type {Map<string, { id: string, nome: string, id_solicitante: string, created_at?: string }[]> | null} */
    equipamentosPendentesMap: null,
    /** @type {string | null} */
    equipOpUnidadePreselect: null,
    /** @type {Record<string, unknown>[] | null} */
    adminPerfisLista: null
};

let calendarioColabMesRef = new Date();
let calendarioAdminEditandoId = null;

const ULTRAMSG_CONFIG = {
    instanceId: 'instance170085',
    token: 'bulzhjv9i0i2k78a',
    numeroTeste: '5514998598003'
};

function normalizarNumeroWhatsapp(valor) {
    return String(valor || '').replace(/\D/g, '');
}

function normalizarTextoBusca(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function mensagemErroCadastroAuth(error) {
    const msg = String(error?.message || '').trim();
    const low = msg.toLowerCase();
    if (low.includes('already registered')) return 'Este e-mail já está cadastrado.';
    if (low.includes('database error saving new user')) {
        return 'Falha ao criar conta no banco (trigger/perfil). Tente novamente. Se persistir, ajuste a função de criação automática de perfil no Supabase.';
    }
    return msg || 'Não foi possível criar a conta.';
}

async function aguardarPerfilDisponivel(userId, tentativas = 8, esperaMs = 350) {
    for (let i = 0; i < tentativas; i++) {
        const { data, error } = await supabase
            .from('perfis')
            .select('id')
            .eq('id', userId)
            .maybeSingle();
        if (!error && data?.id) return true;
        await new Promise((resolve) => setTimeout(resolve, esperaMs));
    }
    return false;
}

async function atualizarPerfilCadastro(userId, payload, camposOpcionais = []) {
    const perfilDisponivel = await aguardarPerfilDisponivel(userId);
    if (!perfilDisponivel) {
        return { error: new Error('Perfil não foi criado no banco após o cadastro. Verifique trigger/policies da tabela perfis.') };
    }

    let tentativaPayload = { ...payload };
    let { error } = await supabase.from('perfis').update(tentativaPayload).eq('id', userId);
    if (!error) return { error: null };

    for (const campo of camposOpcionais) {
        const msg = String(error?.message || '').toLowerCase();
        if (msg.includes(String(campo).toLowerCase())) {
            const { [campo]: _omitido, ...restante } = tentativaPayload;
            tentativaPayload = restante;
            const retry = await supabase.from('perfis').update(tentativaPayload).eq('id', userId);
            error = retry.error;
            if (!error) return { error: null };
        }
    }

    if (error) return { error };

    const colunas = ['id', ...Object.keys(tentativaPayload)];
    const { data: conferido, error: erroConferencia } = await supabase
        .from('perfis')
        .select(colunas.join(','))
        .eq('id', userId)
        .maybeSingle();
    if (erroConferencia || !conferido) {
        return { error: new Error('Perfil atualizado, mas não foi possível confirmar os dados salvos em perfis.') };
    }

    const divergentes = Object.keys(tentativaPayload).filter((k) => {
        const esperado = tentativaPayload[k] ?? null;
        const atual = conferido[k] ?? null;
        return String(esperado ?? '') !== String(atual ?? '');
    });
    if (divergentes.length > 0) {
        return {
            error: new Error(
                `Alguns campos não foram persistidos no perfil (${divergentes.join(', ')}). Verifique as políticas RLS de update/select da tabela perfis para auth.uid().`
            )
        };
    }

    return { error: null };
}

async function criarContaAuthComFallback(email, senha, metadata) {
    const nome = String(metadata?.nome_completo || '').trim();
    const tipoPerfil = String(metadata?.tipo_perfil || '').trim();
    const tentativasMeta = [
        metadata || {},
        { nome_completo: nome, tipo_perfil: tipoPerfil || null },
        { nome_completo: nome || null },
        {}
    ];

    let ultimoErro = null;
    for (const meta of tentativasMeta) {
        const payload = {
            email,
            password: senha,
            options: { data: meta }
        };
        const resp = await supabase.auth.signUp(payload);
        if (!resp.error) return resp;
        ultimoErro = resp.error;

        const low = String(resp.error.message || '').toLowerCase();
        const ehErroDeBanco = low.includes('database error saving new user');
        const ehDuplicado = low.includes('already registered');
        if (!ehErroDeBanco || ehDuplicado) {
            return resp;
        }
    }

    return { data: null, error: ultimoErro };
}

function emailTecnicoPorCpf(cpf) {
    const cpfNum = String(cpf || '').replace(/\D/g, '');
    if (!cpfNum) return '';
    return `${cpfNum}@manutencao.holambra`;
}

function normalizarValorHoras(valor) {
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
    const texto = String(valor ?? '').trim();
    if (!texto) return 0;

    const sinal = texto.startsWith('-') ? -1 : 1;
    const semSinal = texto.replace(/^[+-]/, '');

    if (semSinal.includes(':')) {
        const [hRaw, mRaw = '0'] = semSinal.split(':');
        const horas = Number(hRaw);
        const minutos = Number(mRaw);
        if (!Number.isFinite(horas) || !Number.isFinite(minutos) || minutos < 0 || minutos >= 60) {
            return Number.NaN;
        }
        return sinal * (Math.abs(horas) + (minutos / 60));
    }

    const decimal = Number(semSinal.replace(',', '.'));
    if (!Number.isFinite(decimal)) return Number.NaN;
    return sinal * decimal;
}

function formatarHorasComMinutos(valor, exibirSinal = false) {
    const numero = Number(valor) || 0;
    const sinal = numero < 0 ? '-' : (exibirSinal && numero > 0 ? '+' : '');
    const absoluto = Math.abs(numero);
    const totalMin = Math.round(absoluto * 60);
    const horas = Math.floor(totalMin / 60);
    const minutos = totalMin % 60;
    return `${sinal}${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}h`;
}

const telas = {
    login: document.getElementById('tela-login'),
    cadastro: document.getElementById('tela-cadastro'),
    cadastroOperacao: document.getElementById('tela-cadastro-operacao'),
    menu: document.getElementById('tela-menu'),
    menuOperacao: document.getElementById('tela-menu-operacao'),
    abrirOs: document.getElementById('tela-abrir-os'),
    minhasSolicitacoes: document.getElementById('tela-minhas-solicitacoes'),
    dashboard: document.getElementById('tela-dashboard'),
    historico: document.getElementById('tela-historico'),
    admin: document.getElementById('tela-admin'),
    bancoHoras: document.getElementById('tela-banco-horas'),
    horaExtra: document.getElementById('tela-hora-extra'),
    veiculos: document.getElementById('tela-veiculos'),
    programar: document.getElementById('tela-programar'),
    programacao: document.getElementById('tela-programacao'),
    calendario: document.getElementById('tela-calendario'),
    calendarioAdmin: document.getElementById('tela-calendario-admin'),
    quemNaoApontou: document.getElementById('tela-quem-nao-apontou'),
    ferias: document.getElementById('tela-ferias'),
    gestaoOs: document.getElementById('tela-gestao-os'),
    equipamentosOperacao: document.getElementById('tela-equipamentos-operacao'),
    moinhoIdeias: document.getElementById('tela-moinho-ideias'),
    preventivas: document.getElementById('tela-preventivas')
};

const SETORES_OPERACAO = ['Produção', 'Administrativo', 'Logística', 'Qualidade', 'Manutenção', 'TI', 'RH', 'Financeiro', 'Comercial', 'Almoxarifado', 'Outro'];
const UNIDADES_OPERACAO = ['UBA Matriz', 'UBC Matriz', 'UBS Matriz', 'Holambra', 'Fábrica de Ração', 'Taquarivaí', 'Takaoka', 'Avaré', 'Itaberá', 'São Manuel', 'Taquarituba', 'Taquari'];
const EQUIPAMENTOS_POR_UNIDADE = {
    'AVARÉ': [
        'ELEVADOR 1', 'ELEVADOR 2', 'ELEVADOR 3', 'ELEVADOR 4', 'ELEVADOR 5', 'ELEVADOR 6', 'ELEVADOR 7', 'ELEVADOR 8', 'ELEVADOR 9', 'ELEVADOR 10', 'ELEVADOR 11', 'ELEVADOR 13', 'ELEVADOR 14',
        'CORREIA TRANSPORTADORA 1', 'TC. 2 MOEGA', 'TC. 3 MOEGA', 'TC. 4 MOEGA', 'TC. 5', 'TC. 6', 'TC. 7', 'TC. 8', 'TC. 9', 'TC. 10', 'TC. 11', 'TC. 13', 'TC. 14', 'TC. 15', 'TC. 16', 'TC. 17', 'TC. 18', 'TC. 19', 'TC. 20', 'TC. 12',
        'TRANSP. DE ROSCA IMPUREZA GROSSA 1', 'TRANSP. DE ROSCA IMPUREZA GROSSA 2', 'TRANSP. DE ROSCA IMPUREZA GROSSA 3', 'TRANSP. DE ROSCA IMPUREZA GROSSA 4',
        'TRANSP. DE ROSCA IMPUREZA FINA 1', 'TRANSP. DE ROSCA IMPUREZA FINA 2', 'TRANSP. DE ROSCA IMPUREZA FINA 3', 'TRANSP. DE ROSCA IMPUREZA FINA 4',
        'PL 01', 'PL 02', 'SECADOR 1', 'FILTRO DE MANGA 1', 'FILTRO DE MANGA 2', 'FILTRO DE MANGA 3', 'FILTRO DE MANGA 4',
        'AERAÇÃO SILO 01', 'AERAÇÃO SILO 02', 'AERAÇÃO SILO 03', 'AERAÇÃO SILO 04', 'AERAÇÃO SILO 05', 'AERAÇÃO SILO 06', 'AERAÇÃO SILO 07', 'AERAÇÃO SILO 08',
        'SILO PULMÃO 01', 'SILO PULMÃO 02'
    ],
    'TAK 1': [
        'ELEVADOR 1', 'ELEVADOR 2', 'ELEVADOR 3', 'ELEVADOR 4', 'ELEVADOR 5', 'ELEVADOR 6', 'ELEVADOR 7', 'ELEVADOR 8', 'ELEVADOR 9 (PULMÃO)', 'ELEVADOR 9 (MOEGA)',
        'ELEVADOR 10 (PULMÃO)', 'ELEVADOR 10 (MOEGA)', 'ELEVADOR 11 (MOEGA)', 'ELEVADOR 12 (MOEGA)', 'ELEVADOR 13', 'ELEVADOR 14', 'ELEVADOR 15', 'ELEVADOR 16', 'ELEVADOR 17', 'ELEVADOR 18',
        'CORREIA TRANSPORTADORA 1', 'CORREIA TRANSPORTADORA 2', 'TC. DIREITO', 'TC. 1 SECADOR 3', 'TC. 2 SECADOR 4', 'TC. 3 LADO ESQUERDO', 'TC. 1', 'TC. 2', 'TC. 4 LADO DIREITO',
        'TC. 6 LADO DIREITO', 'TC. 7 LADO ESQUERDO', 'TC. 8 LADO DIREITO', 'TC. 9 LADO ESQUERDO', 'TC. 9 PULMÃO DIREITO', 'TC. 10 LADO DIREITO', 'TC. 10 LADO ESQUERDO',
        'TC. 11 MOEGA', 'TC. 11 PULMÃO', 'TC. 12 MOEGA', 'TC. 12 PULMÃO', 'TC. 13 ESQUERDO', 'TC. 14', 'TC. 16 ESQUERDO', 'TC. 17', 'TC. 18', 'TC. 19', 'TC. 20', 'TC. 21', 'TC. 22', 'TC. 23', 'TC. 24', 'TC. 25 INCLINADO',
        'TRANSPORTADOR DE ROSCA TH D1', 'TRANSPORTADOR DE ROSCA TH D2', 'ROSCA TRANSPORTADORA PRÉ E PÓS',
        'PL 01', 'PL 02', 'PL 03', 'PL 04', 'SECADOR 3 DISTRIBUIDOR', 'SECADOR 4 DISTRIBUIDOR', 'SECADOR ADS 100'
    ],
    'TAK 2': [
        'ELEVADOR 1', 'ELEVADOR 2', 'ELEVADOR 3', 'ELEVADOR 4', 'ELEVADOR 5', 'ELEVADOR 6', 'ELEVADOR 7', 'ELEVADOR 14', 'ELEVADOR 16', 'ELEVADOR 18',
        'TC. 1 MOEGA', 'TC. 2 PULMÃO', 'TC. 3', 'TC. 4 TÚNEL PULMÃO', 'TC. 5 P/ ELEVADOR 5', 'TC. 5 P/ ELEVADOR 7', 'TC. 6', 'TC. 7', 'TC. 8', 'TC. 9', 'TC. 10', 'TC. 11',
        'TC. 12', 'TC. 13', 'TC. 24', 'TC. 25', 'TC. 26', 'TC. 27', 'TC. 30', 'TC. 31', 'TC. 32', 'TC. 33', 'TC. 34', 'TC. 37',
        'ROSCA VARREDORA SILO 20', 'ROSCA VARREDORA SILO 22', 'PL 05'
    ],
    'TAQUARIVAÍ': [
        'ELEVADOR 4 MOEGA', 'ELEVADOR 7 MOEGA', 'ELEVADOR 2 MOEGA', 'ELEVADOR 5 MOEGA', 'PRÉ-LIMPEZA CASP', 'PRÉ-LIMPEZA ENTRINGER',
        'ELEVADOR SECADOR CASP', 'ELEVADOR RESÍDUO', 'ELEVADOR SECADOR ENTRINGER', 'ROSCA DE RESÍDUO', 'FITA PRINCIPAL 1', 'FITA PRINCIPAL 2',
        'FITA INFERIOR SILO 1', 'FITA INFERIOR SILO 2', 'FITA INFERIOR SILO 3', 'FITA INFERIOR SILO 4', 'FITA INFERIOR SILO 5', 'FITA INFERIOR SILO 6',
        'ELEVADOR 3', 'ELEVADOR 6', 'REDLER 1 ENTRE SILOS', 'REDLER 2 ENTRE SILOS', 'FITA SUPERIOR SILO 3', 'FITA SUPERIOR SILO 4', 'REDLER SUPERIOR SILO 5', 'REDLER SUPERIOR SILO 6'
    ],
    'ITABERÁ': [
        'FITA MOEGA 1 E 2 INFERIOR', 'FITA MOEGA 3 E 4 INFERIOR', 'ELEVADOR 12', 'ELEVADOR 13', 'FITA REVERSÍVEL 1', 'FITA REVERSÍVEL 2',
        'PRÉ-LIMPEZA 1', 'PRÉ-LIMPEZA 2', 'PRÉ-LIMPEZA 3', 'PRÉ-LIMPEZA 4', 'REDLER 1', 'REDLER 2', 'ELEVADOR 19', 'ELEVADOR 15', 'ELEVADOR 14', 'ELEVADOR 16', 'ELEVADOR 17', 'ELEVADOR 20',
        'ELEVADOR RESÍDUO 1', 'ELEVADOR RESÍDUO 2', 'ELEVADOR RESÍDUO 3', 'ELEVADOR RESÍDUO 4', 'SILO RESÍDUO ROSCA 1', 'SILO RESÍDUO ROSCA 2', 'ROSCA TL1', 'ROSCA TL3', 'ROSCA RTMG1', 'ROSCA RTL4', 'ROSCA RTL2', 'ROSCA RTMG2',
        'SILO PULMÃO 1 FITA SUPERIOR', 'SILO PULMÃO 2 FITA SUPERIOR', 'SILO PULMÃO 1 INFERIOR', 'SILO PULMÃO 2 INFERIOR',
        'REDLER INFERIOR SECADOR 1', 'REDLER INFERIOR SECADOR 2', 'ELEVADOR 10', 'ELEVADOR 11', 'ELEVADOR 21',
        'FITA SUPERIOR SILO 1', 'FITA INFERIOR SILO 1', 'FITA SUPERIOR SILO 2', 'FITA INFERIOR SILO 2', 'FITA SUPERIOR SILO 3', 'FITA INFERIOR SILO 3', 'FITA SUPERIOR SILO 4', 'FITA INFERIOR SILO 4',
        'FITA DESCARGA LINHA 1', 'FITA DESCARGA LINHA 2', 'ELEVADOR 37', 'ELEVADOR 38'
    ],
    'TAQUARITUBA': [
        'ELEVADOR MOEGA 1 E 2', 'ELEVADOR SECADOR', 'ELEVADOR DE RESÍDUO 1', 'ELEVADOR DE RESÍDUO 2', 'ELEVADOR CARREGAMENTO',
        'REDLER INFERIOR SILO PULMÃO', 'PRÉ-LIMPEZA', 'REDLER INFERIOR TC2', 'REDLER INFERIOR SECADOR', 'REDLER SUPERIOR SECADOR', 'REDLER INFERIOR SILO'
    ],
    'MATRIZ': [
        'ELEVADOR 1 (MOEGA 9)', 'ELEVADOR 2 (ENTRINGER)', 'ELEVADOR 2 (MOEGA 6)', 'ELEVADOR 2 (SEC. 315 )', 'ELEVADOR 3 (SEC. ENTRINGER)', 'ELEVADOR 4', 'ELEVADOR 5',
        'ELEVADOR 18 (KEPLER)', 'ELEVADOR 25', 'ELEVADOR 27', 'ELEVADOR 29', 'ELEVADOR 34', 'ELEVADOR 36',
        'CORREIA TRANSPORTADORA 1', 'CORREIA TRANSPORTADORA 2', 'CORREIA TRANSPORTADORA 3', 'CORREIA TRANSPORTADORA 4', 'CORREIA TRANSPORTADORA 5', 'CORREIA TRANSPORTADORA 6',
        'TC. 1 MOEGA', 'TC. 2 MOEGA', 'TC. 3 MOEGA', 'TC. 4 MOEGA', 'TC. 5', 'TC. 6', 'TC. 7', 'TC. 8', 'TC. 9', 'TC. 10', 'TC. 11', 'TC. 12',
        'TRANSP. DE ROSCA IMPUREZA GROSSA 1', 'TRANSP. DE ROSCA IMPUREZA GROSSA 2', 'TRANSP. DE ROSCA IMPUREZA GROSSA 3', 'TRANSP. DE ROSCA IMPUREZA GROSSA 4',
        'TRANSP. DE ROSCA IMPUREZA FINA 1', 'TRANSP. DE ROSCA IMPUREZA FINA 2', 'TRANSP. DE ROSCA IMPUREZA FINA 3', 'TRANSP. DE ROSCA IMPUREZA FINA 4',
        'PL 01', 'PL 02', 'PL 03 - Kepler', 'PL 04 - Buhler', 'SECADOR 1', 'SECADOR 2', 'SECADOR 3', 'SECADOR 4', 'FILTRO DE MANGA 1', 'FILTRO DE MANGA 2', 'FILTRO DE MANGA 3', 'FILTRO DE MANGA 4'
    ],
    'SÃO MANUEL': [
        'ELEVADOR 1', 'ELEVADOR  2', 'ELEVADOR 3', 'ELEVADOR 4', 'ELEVADOR 5',
        'TRANSP. DE ROSCA  01', 'TRANSP. DE ROSCA  TRUA SC-01', 'TRANSP. DE ROSCA  EL-04 e 05', 'TRANSP. DE ROSCA  SILO 01', 'TRANSP. DE ROSCA  SILO 05', 'TRANSP. DE ROSCA  SILO 06',
        'PL 01 KEPLER', 'PL 02 ENTRINGER', 'SECADOR CASP', 'TC SUPERIOR SILO 05', 'TC SUPERIOR SILO 06', 'TC 01', 'TC 02', 'TC 03'
    ],
    'FABRICA': ['MOINHO PEQUENO', 'MOINHO GRANDE', 'CAIXA DOSADORA (CONJUNTO)']
};
let suporteCampoEquipamentoApontamento = null;
let suporteCampoSetorCentroApontamento = null;

const SETORES = [
    '11014 MT',
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

function popularSelectSetoresMT(selectId, placeholder = 'Selecione o setor (código)...') {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    SETORES.forEach((s) => {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s;
        sel.appendChild(o);
    });
}

function extrairUnidadeDeSetorProgramado(setorRaw) {
    if (!setorRaw) return '';
    const valorOriginal = String(setorRaw).trim();
    const valorUpper = valorOriginal.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const ultimoTrecho = valorOriginal.includes(' - ')
        ? valorOriginal.split(' - ').pop().trim()
        : valorOriginal;
    const ultimoUpper = ultimoTrecho.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

    if (/(^|\s)TAK(\s|$)/.test(ultimoUpper) || /(^|\s)TAK(\s|$)/.test(valorUpper)) return 'Takaoka';
    if (/(^|\s)AV(\s|$)/.test(ultimoUpper) || /(^|\s)AV(\s|$)/.test(valorUpper)) return 'Avaré';
    if (/(^|\s)TAQ(\s|$)/.test(ultimoUpper) || /(^|\s)TAQ(\s|$)/.test(valorUpper)) return 'Taquarivaí';
    if (/(^|\s)TQRI(\s|$)/.test(ultimoUpper) || /(^|\s)TQRI(\s|$)/.test(valorUpper)) return 'Taquari';
    if (/(^|\s)TQBA(\s|$)/.test(ultimoUpper) || /(^|\s)TQBA(\s|$)/.test(valorUpper)) return 'Taquarituba';
    if (/(^|\s)ITABE(\s|$)/.test(ultimoUpper) || /(^|\s)ITABE(\s|$)/.test(valorUpper)) return 'Itaberá';
    if (/(^|\s)S\.?MANU(\s|$)/.test(ultimoUpper) || /(^|\s)S\.?MANU(\s|$)/.test(valorUpper)) return 'São Manuel';
    if (/(^|\s)UBA(\s|$)/.test(ultimoUpper) || /(^|\s)UBA(\s|$)/.test(valorUpper)) return 'UBA Matriz';
    if (/(^|\s)UBC(\s|$)/.test(ultimoUpper) || /(^|\s)UBC(\s|$)/.test(valorUpper)) return 'UBC Matriz';
    if (/(^|\s)UBS(\s|$)/.test(ultimoUpper) || /(^|\s)UBS(\s|$)/.test(valorUpper)) return 'UBS Matriz';
    if (/(^|\s)HOLAMBRA(\s|$)/.test(ultimoUpper) || /(^|\s)HOLAMBRA(\s|$)/.test(valorUpper)) return 'Holambra';
    if (/(^|\s)(RACAO|RA[CÇ]AO|FABRICA)(\s|$)/.test(ultimoUpper) || /(^|\s)(RACAO|RA[CÇ]AO|FABRICA)(\s|$)/.test(valorUpper)) return 'Fábrica de Ração';

    return ultimoTrecho;
}

function normalizarChaveUnidadeEquipamento(unidadeRaw) {
    if (!unidadeRaw) return '';
    const unidadeExtraida = extrairUnidadeDeSetorProgramado(unidadeRaw);
    let unidade = String(unidadeExtraida || unidadeRaw).trim();
    const semAcento = unidade.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const upper = semAcento.toUpperCase();
    if (upper === 'AVARE') return 'AVARÉ';
    if (upper === 'ITABERA') return 'ITABERÁ';
    if (upper === 'SAO MANUEL') return 'SÃO MANUEL';
    if (upper === 'TAQUARIVAI') return 'TAQUARIVAÍ';
    if (upper === 'FABRICA DE RACAO' || upper === 'FABRICA') return 'FABRICA';
    if (upper === 'TAKAOKA' || upper === 'TAK 1') return 'TAK 1';
    if (upper === 'TAK2' || upper === 'TAK 2') return 'TAK 2';
    if (upper === 'MATRIZ') return 'MATRIZ';
    if (upper === 'TAQUARITUBA') return 'TAQUARITUBA';
    return unidade.toUpperCase();
}

async function carregarEquipamentosExtrasSupabase() {
    const m = new Map();
    if (!estado.usuario) {
        estado.equipamentosExtrasMap = m;
        return;
    }
    const { data, error } = await supabase.from('equipamentos_extras').select('id, unidade_chave, nome').order('nome');
    if (error) {
        estado.equipamentosExtrasMap = m;
        const msg = String(error.message || '');
        if (!msg.includes('does not exist') && !msg.includes('schema cache') && error.code !== 'PGRST116') {
            console.warn('equipamentos_extras:', error);
        }
        return;
    }
    for (const row of data || []) {
        const k = row.unidade_chave;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push({ id: row.id, nome: row.nome });
    }
    estado.equipamentosExtrasMap = m;
}

async function carregarEquipamentosPendentesSupabase() {
    const m = new Map();
    if (!estado.usuario) {
        estado.equipamentosPendentesMap = m;
        return;
    }
    const { data, error } = await supabase
        .from('equipamentos_extras_solicitacoes')
        .select('id, unidade_chave, nome, id_solicitante, created_at')
        .eq('status', 'pendente')
        .order('created_at', { ascending: false });
    if (error) {
        estado.equipamentosPendentesMap = m;
        const msg = String(error.message || '');
        if (!msg.includes('does not exist') && !msg.includes('schema cache') && error.code !== 'PGRST116') {
            console.warn('equipamentos_extras_solicitacoes:', error);
        }
        return;
    }
    for (const row of data || []) {
        const k = row.unidade_chave;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push({
            id: row.id,
            nome: row.nome,
            id_solicitante: row.id_solicitante,
            created_at: row.created_at
        });
    }
    estado.equipamentosPendentesMap = m;
}

function obterLinhasPendentesUnidade(unidadeRaw) {
    const k = chaveStorageEquipamentosExtras(unidadeRaw);
    if (!k || !estado.equipamentosPendentesMap) return [];
    return estado.equipamentosPendentesMap.get(k) || [];
}

function rotuloUnidadePorChaveEquipamento(chave) {
    if (!chave) return '—';
    if (chave === '__MATRIZ__') return 'Matriz (UBA / UBC / UBS / Holambra)';
    if (chave === '__TAKAOKA__') return 'Takaoka (TAK 1 / TAK 2)';
    const u = UNIDADES_OPERACAO.find((x) => chaveStorageEquipamentosExtras(x) === chave);
    return u || chave;
}

function obterLinhasExtrasUnidade(unidadeRaw) {
    const k = chaveStorageEquipamentosExtras(unidadeRaw);
    if (!k || !estado.equipamentosExtrasMap) return [];
    return estado.equipamentosExtrasMap.get(k) || [];
}

function chaveStorageEquipamentosExtras(unidadeRaw) {
    if (!unidadeRaw) return '';
    const display = String(extrairUnidadeDeSetorProgramado(unidadeRaw) || unidadeRaw).trim();
    const hol = display.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (['HOLAMBRA', 'UBA MATRIZ', 'UBC MATRIZ', 'UBS MATRIZ'].includes(hol) || /^UB[ACS]\s+MATRIZ$/i.test(display)) {
        return '__MATRIZ__';
    }
    if (hol.includes('TAKAOKA') || hol === 'TAK 1' || hol === 'TAK 2') {
        return '__TAKAOKA__';
    }
    return normalizarChaveUnidadeEquipamento(display);
}

function obterEquipamentosExtrasParaUnidade(unidadeRaw) {
    return obterLinhasExtrasUnidade(unidadeRaw).map((r) => String(r.nome).trim()).filter(Boolean);
}

async function adicionarEquipamentoExtraNaUnidade(unidadeRaw, nomeEquipamento) {
    const nome = String(nomeEquipamento || '').trim();
    if (!nome) return { ok: false, msg: 'Digite o nome do equipamento.' };
    if (nome.length > 200) return { ok: false, msg: 'Nome muito longo (máx. 200 caracteres).' };
    const k = chaveStorageEquipamentosExtras(unidadeRaw);
    if (!k) return { ok: false, msg: 'Selecione uma unidade.' };
    if (!estado.usuario?.id) return { ok: false, msg: 'Faça login novamente.' };
    await carregarEquipamentosExtrasSupabase();
    await carregarEquipamentosPendentesSupabase();
    const lower = nome.toLowerCase();
    const listaCompleta = obterListaEquipamentosParaUnidade(unidadeRaw);
    if (listaCompleta.some((x) => String(x).trim().toLowerCase() === lower)) {
        return { ok: false, msg: 'Este equipamento já está na lista (padrão ou já cadastrado).' };
    }
    const pendLower = obterLinhasPendentesUnidade(unidadeRaw).map((r) => String(r.nome).trim().toLowerCase());
    if (pendLower.includes(lower)) {
        return { ok: false, msg: 'Já existe uma solicitação pendente com este nome para esta unidade.' };
    }
    const ehAdmin = estado.perfil?.funcao === 'admin';
    if (ehAdmin) {
        const { error } = await supabase.from('equipamentos_extras').insert({
            unidade_chave: k,
            nome,
            id_criador: estado.usuario.id
        });
        if (error) {
            if (error.code === '23505') {
                return { ok: false, msg: 'Este equipamento já existe para esta unidade.' };
            }
            if (String(error.message || '').includes('does not exist')) {
                return {
                    ok: false,
                    msg: 'Tabela não encontrada. Execute supabase_setup_equipamentos_extras.sql no Supabase.'
                };
            }
            return { ok: false, msg: error.message || 'Não foi possível salvar.' };
        }
        await carregarEquipamentosExtrasSupabase();
        return { ok: true, modo: 'direto' };
    }
    const { error } = await supabase.from('equipamentos_extras_solicitacoes').insert({
        unidade_chave: k,
        nome,
        id_solicitante: estado.usuario.id,
        status: 'pendente'
    });
    if (error) {
        if (error.code === '23505') {
            return { ok: false, msg: 'Já existe solicitação pendente ou nome duplicado para esta unidade.' };
        }
        if (String(error.message || '').includes('does not exist')) {
            return {
                ok: false,
                msg: 'Tabela de solicitações não encontrada. Execute supabase_setup_equipamentos_extras_solicitacoes.sql no Supabase.'
            };
        }
        return { ok: false, msg: error.message || 'Não foi possível enviar a solicitação.' };
    }
    await carregarEquipamentosPendentesSupabase();
    return { ok: true, modo: 'pendente' };
}

async function cancelarSolicitacaoEquipPorId(id) {
    const { error } = await supabase.from('equipamentos_extras_solicitacoes').delete().eq('id', id);
    if (error) {
        mostrarErro('Cancelar solicitação', error.message || 'Não foi possível cancelar.');
        return false;
    }
    await carregarEquipamentosPendentesSupabase();
    return true;
}

async function aprovarSolicitacaoEquipamentoAdmin(row) {
    if (!row?.id || !row.unidade_chave || !row.nome) return false;
    // id_criador deve ser auth.uid() do usuário logado: políticas RLS de equipamentos_extras
    // costumam exigir que quem insere seja o criador (admin aprovando = sessão do admin).
    const { error: insErr } = await supabase.from('equipamentos_extras').insert({
        unidade_chave: row.unidade_chave,
        nome: String(row.nome).trim(),
        id_criador: estado.usuario.id
    });
    if (insErr && insErr.code !== '23505') {
        mostrarErro('Aprovar equipamento', insErr.message || 'Falha ao gravar na lista aprovada.');
        return false;
    }
    const { error: delErr } = await supabase.from('equipamentos_extras_solicitacoes').delete().eq('id', row.id);
    if (delErr) {
        mostrarErro('Aprovar equipamento', delErr.message || 'Gravou o item mas não removeu a solicitação.');
        return false;
    }
    await carregarEquipamentosExtrasSupabase();
    await carregarEquipamentosPendentesSupabase();
    return true;
}

async function rejeitarSolicitacaoEquipamentoAdmin(id) {
    const { error } = await supabase.from('equipamentos_extras_solicitacoes').delete().eq('id', id);
    if (error) {
        mostrarErro('Recusar solicitação', error.message || 'Falha ao recusar.');
        return false;
    }
    await carregarEquipamentosPendentesSupabase();
    return true;
}

async function excluirEquipamentoExtraPorId(id) {
    const { error } = await supabase.from('equipamentos_extras').delete().eq('id', id);
    if (error) {
        mostrarErro('Excluir equipamento', error.message || 'Sem permissão ou equipamento já removido.');
        return false;
    }
    await carregarEquipamentosExtrasSupabase();
    return true;
}

function obterListaEquipamentosParaUnidade(unidadeRaw) {
    if (!unidadeRaw) return [];
    const display = String(extrairUnidadeDeSetorProgramado(unidadeRaw) || unidadeRaw).trim();
    const hol = display.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    let base;
    if (['HOLAMBRA', 'UBA MATRIZ', 'UBC MATRIZ', 'UBS MATRIZ'].includes(hol) || /^UB[ACS]\s+MATRIZ$/i.test(display)) {
        base = [...(EQUIPAMENTOS_POR_UNIDADE.MATRIZ || [])];
    } else if (hol.includes('TAKAOKA') || hol === 'TAK 1' || hol === 'TAK 2') {
        const a = EQUIPAMENTOS_POR_UNIDADE['TAK 1'] || [];
        const b = EQUIPAMENTOS_POR_UNIDADE['TAK 2'] || [];
        base = [...new Set([...a, ...b])].sort((x, y) => x.localeCompare(y, 'pt-BR'));
    } else {
        const chave = normalizarChaveUnidadeEquipamento(display);
        const list = EQUIPAMENTOS_POR_UNIDADE[chave];
        base = Array.isArray(list) ? [...list] : [];
    }
    const extras = obterEquipamentosExtrasParaUnidade(unidadeRaw);
    if (!extras.length) return base;
    return [...new Set([...base, ...extras])].sort((x, y) => x.localeCompare(y, 'pt-BR'));
}

const cabecalho = document.getElementById('cabecalho-principal');
const menuMobile = document.getElementById('menu-mobile');

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

const LIMITE_DIARIO_MINUTOS = 9 * 60;
const LIMITE_DIARIO_TEXTO_LEGIVEL = '9 h';

function duracaoMinutosIntervalo(inicio, fim) {
    if (!inicio || !fim) return 0;
    const p = (s) => {
        const [h, m] = String(s).split(':').map(Number);
        return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    };
    let start = p(inicio);
    let end = p(fim);
    if (end < start) end += 24 * 60;
    return end - start;
}

function formatarMinutosComoH(min) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h}h${String(m).padStart(2, '0')}`;
}

async function totalMinutosApontadosNoDia(idManutentor, dataServico, excludeAptId) {
    const { data, error } = await supabase
        .from('apontamentos')
        .select('id, hora_inicio, hora_fim')
        .eq('id_manutentor', idManutentor)
        .eq('data_servico', dataServico);
    if (error || !data) return 0;
    let total = 0;
    for (const row of data) {
        if (excludeAptId && row.id === excludeAptId) continue;
        total += duracaoMinutosIntervalo(row.hora_inicio, row.hora_fim);
    }
    return total;
}

let limiteDiaTimer = null;
async function atualizarIndicadorLimiteDia() {
    const el = document.getElementById('apt-limite-dia-texto');
    const box = document.getElementById('apt-limite-dia');
    if (!el || !estado.usuario) return;
    const idManutentor = document.getElementById('apt-manutentor')?.value;
    const dataServico = document.getElementById('apt-data')?.value;
    const inicio = document.getElementById('apt-inicio')?.value;
    const fim = document.getElementById('apt-fim')?.value;
    if (!idManutentor || !dataServico) {
        el.textContent = `Selecione data e manutentor para ver o saldo do dia (limite ${LIMITE_DIARIO_TEXTO_LEGIVEL}).`;
        if (box) box.classList.remove('limite-dia-alerta');
        lucide.createIcons();
        return;
    }
    el.textContent = 'Calculando…';
    const excluir = apontamentoEditando?.id || null;
    const ja = await totalMinutosApontadosNoDia(idManutentor, dataServico, excluir);
    const este = duracaoMinutosIntervalo(inicio, fim);
    const depois = ja + este;
    const restante = Math.max(0, LIMITE_DIARIO_MINUTOS - ja);
    el.textContent = `Já apontado neste dia: ${formatarMinutosComoH(ja)} · Este intervalo: ${formatarMinutosComoH(este)} · Após salvar: ${formatarMinutosComoH(depois)} (máx. ${formatarMinutosComoH(LIMITE_DIARIO_MINUTOS)})`;
    if (box) {
        box.classList.toggle('limite-dia-alerta', depois > LIMITE_DIARIO_MINUTOS);
    }
    lucide.createIcons();
}

function setAdminTab(tab) {
    const painel = document.getElementById('admin-conteudo-painel');
    const rel = document.getElementById('admin-conteudo-relatorio-os');
    const btnP = document.getElementById('admin-tab-painel');
    const btnR = document.getElementById('admin-tab-relatorio-os');
    if (!painel || !rel) return;
    const isRel = tab === 'relatorio';
    painel.classList.toggle('oculto', isRel);
    rel.classList.toggle('oculto', !isRel);
    if (btnP) {
        btnP.classList.toggle('admin-tab-ativo', !isRel);
        btnP.setAttribute('aria-selected', !isRel ? 'true' : 'false');
    }
    if (btnR) {
        btnR.classList.toggle('admin-tab-ativo', isRel);
        btnR.setAttribute('aria-selected', isRel ? 'true' : 'false');
    }
    if (isRel) {
        carregarResumoRelatorioOSAbertas();
    }
    lucide.createIcons();
}

async function carregarResumoRelatorioOSAbertas() {
    const resumo = document.getElementById('relatorio-os-abertas-resumo');
    const lista = document.getElementById('lista-preview-os-abertas');
    if (resumo) resumo.textContent = 'Carregando…';
    if (lista) lista.innerHTML = '';
    const { data, error } = await supabase
        .from('ordens_servico')
        .select('*')
        .eq('status', 'aberta')
        .order('criado_em', { ascending: false });
    if (error) {
        if (resumo) resumo.textContent = 'Erro ao carregar. Verifique conexão e políticas do banco.';
        return;
    }
    const arr = data || [];
    const n = arr.length;
    if (resumo) {
        resumo.textContent = n === 0
            ? 'Nenhuma OS com status «aberta» no momento.'
            : `${n} ordem(ns) de serviço em aberto.`;
    }
    if (!lista) return;
    if (n === 0) {
        lista.innerHTML = '<p class="centro preview-os-vazio">Nada para exibir.</p>';
        return;
    }
    lista.innerHTML = arr.slice(0, 12).map((os) => {
        const num = String(os.numero_solicitacao || os.id || '—').replace(/</g, '&lt;');
        const desc = String(os.descricao || os.titulo || '—').replace(/</g, '&lt;');
        const setor = String(os.setor || os.unidade || '—').replace(/</g, '&lt;');
        const centro = os.setor_centro ? ` · ${String(os.setor_centro).replace(/</g, '&lt;')}` : '';
        const curto = desc.length > 140 ? `${desc.slice(0, 140)}…` : desc;
        return `<div class="preview-os-item"><strong>#${num}</strong><span class="preview-os-setor">${setor}${centro}</span><p class="preview-os-desc">${curto}</p></div>`;
    }).join('');
    if (n > 12) {
        lista.insertAdjacentHTML('beforeend', `<p class="preview-os-mais">+ ${n - 12} outra(s) no arquivo Excel.</p>`);
    }
}

function definirTelaVisivel(el, visivel) {
    if (!el) return;
    if (visivel) {
        el.classList.remove('oculto');
        el.removeAttribute('hidden');
        el.removeAttribute('aria-hidden');
    } else {
        el.classList.add('oculto');
        el.setAttribute('hidden', '');
        el.setAttribute('aria-hidden', 'true');
    }
}

function obterTelaInicio() {
    if ((estado.perfil?.tipo_perfil || '') === 'operacao') return 'menuOperacao';
    return 'menu';
}

async function navegarParaInicio() {
    await navegarPara(obterTelaInicio());
}

function registrarVoltarInicio(...ids) {
    ids.forEach((id) => {
        document.getElementById(id)?.addEventListener('click', () => {
            navegarParaInicio();
        });
    });
}

function atualizarMenuLateralNav() {
    if (!estado.usuario || !estado.perfil) return;

    const navAdmin = document.getElementById('nav-admin');
    const navHoraExtra = document.getElementById('nav-hora-extra');
    const navProgramar = document.getElementById('nav-programar');
    const navInicio = document.getElementById('nav-inicio');
    const navHistorico = document.getElementById('nav-historico');
    const navVeiculos = document.getElementById('nav-veiculos');
    const navProgramacao = document.getElementById('nav-programacao');
    const navCalendario = document.getElementById('nav-calendario');
    const navProgramarCalendario = document.getElementById('nav-programar-calendario');
    const navQuemNaoApontou = document.getElementById('nav-quem-nao-apontou');
    const navOperacaoInicio = document.getElementById('nav-operacao-inicio');
    const navAbrirOs = document.getElementById('nav-abrir-os');
    const navMinhasSolicitacoes = document.getElementById('nav-minhas-solicitacoes');
    const navEquipamentosOp = document.getElementById('nav-equipamentos-operacao');
    const navOrdensServico = document.getElementById('nav-ordens-servico');
    const navRelatorioOsAbertas = document.getElementById('nav-relatorio-os-abertas');
    const menuUsuario = document.getElementById('menu-usuario');
    const menuAdmin = document.getElementById('menu-admin');

    const isOperacao = estado.perfil.tipo_perfil === 'operacao';
    const isAdmin = estado.perfil.funcao === 'admin';

    if (isAdmin) {
        navAdmin?.classList.remove('oculto');
        navHoraExtra?.classList.remove('oculto');
        navProgramar?.classList.remove('oculto');
        navInicio?.classList.remove('oculto');
        navHistorico?.classList.remove('oculto');
        navVeiculos?.classList.remove('oculto');
        navProgramacao?.classList.remove('oculto');
        navCalendario?.classList.remove('oculto');
        navOrdensServico?.classList.remove('oculto');
        navRelatorioOsAbertas?.classList.remove('oculto');
        navProgramarCalendario?.classList.remove('oculto');
        navQuemNaoApontou?.classList.remove('oculto');
        navOperacaoInicio?.classList.add('oculto');
        navAbrirOs?.classList.add('oculto');
        navMinhasSolicitacoes?.classList.add('oculto');
        navEquipamentosOp?.classList.add('oculto');
        menuUsuario?.classList.add('oculto');
        menuAdmin?.classList.remove('oculto');
    } else if (isOperacao) {
        navAdmin?.classList.add('oculto');
        navHoraExtra?.classList.add('oculto');
        navProgramar?.classList.add('oculto');
        navInicio?.classList.add('oculto');
        navHistorico?.classList.add('oculto');
        navVeiculos?.classList.add('oculto');
        navProgramacao?.classList.add('oculto');
        navCalendario?.classList.add('oculto');
        navOrdensServico?.classList.add('oculto');
        navRelatorioOsAbertas?.classList.add('oculto');
        navProgramarCalendario?.classList.add('oculto');
        navQuemNaoApontou?.classList.add('oculto');
        navOperacaoInicio?.classList.remove('oculto');
        navAbrirOs?.classList.remove('oculto');
        navMinhasSolicitacoes?.classList.remove('oculto');
        navEquipamentosOp?.classList.remove('oculto');
        menuUsuario?.classList.add('oculto');
        menuAdmin?.classList.add('oculto');
    } else {
        navAdmin?.classList.add('oculto');
        navHoraExtra?.classList.add('oculto');
        navProgramar?.classList.add('oculto');
        navInicio?.classList.remove('oculto');
        navHistorico?.classList.remove('oculto');
        navVeiculos?.classList.remove('oculto');
        navProgramacao?.classList.remove('oculto');
        navCalendario?.classList.remove('oculto');
        navOperacaoInicio?.classList.add('oculto');
        navAbrirOs?.classList.add('oculto');
        navMinhasSolicitacoes?.classList.add('oculto');
        navEquipamentosOp?.classList.add('oculto');
        navOrdensServico?.classList.add('oculto');
        navRelatorioOsAbertas?.classList.add('oculto');
        navProgramarCalendario?.classList.add('oculto');
        navQuemNaoApontou?.classList.add('oculto');
        menuUsuario?.classList.remove('oculto');
        menuAdmin?.classList.add('oculto');
    }
}

async function navegarPara(idTela, opts = {}) {
    if (idTela !== 'minhasSolicitacoes' && estado.realtimeChannelOS) {
        supabase.removeChannel(estado.realtimeChannelOS);
        estado.realtimeChannelOS = null;
    }
    window.scrollTo(0, 0);
    Object.values(telas).forEach((el) => {
        if (el) definirTelaVisivel(el, false);
    });

    const telaAlvo = telas[idTela];
    if (telaAlvo) {
        definirTelaVisivel(telaAlvo, true);
    } else {
        console.warn('navegarPara: tela desconhecida', idTela);
        definirTelaVisivel(telas.login, true);
    }
    lucide.createIcons();

    if (cabecalho) {
        if (idTela === 'login' || idTela === 'cadastro' || idTela === 'cadastroOperacao') {
            cabecalho.classList.add('oculto');
        } else {
            cabecalho.classList.remove('oculto');
            atualizarNomeUsuario();
        }
    }
    if (menuMobile) menuMobile.classList.add('oculto');

    if (!['login', 'cadastro', 'cadastroOperacao'].includes(idTela)) {
        atualizarMenuLateralNav();
    }

    if (idTela === 'menu') {
        await carregarDashboardInicio();
    }
    if (idTela === 'menuOperacao') {
        await carregarDashboardOperacao();
    }
    if (idTela === 'dashboard') {
        carregarUsuarios();
        atualizarVisibilidadeCamposAdmin();
        clearTimeout(limiteDiaTimer);
        limiteDiaTimer = setTimeout(() => atualizarIndicadorLimiteDia(), 300);
    }
    if (idTela === 'historico') carregarHistorico();
    if (idTela === 'admin') {
        carregarDadosAdmin();
        if (opts.adminTab === 'relatorio') {
            setAdminTab('relatorio');
        } else {
            setAdminTab('painel');
        }
    }
    if (idTela === 'gestaoOs') {
        preencherFiltrosGestaoOS();
        carregarGestaoOS();
    }
    if (idTela === 'minhasSolicitacoes') {
        carregarMinhasSolicitacoes();
        iniciarRealtimeMinhasSolicitacoes();
    }
    if (idTela === 'abrirOs') await preencherSelectsAbrirOS();
    if (idTela === 'equipamentosOperacao') await preencherTelaEquipamentosOperacao();
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
    if (idTela === 'calendario') carregarCalendarioColaborador();
    if (idTela === 'calendarioAdmin') carregarCalendarioAdmin();
    if (idTela === 'quemNaoApontou') carregarQuemNaoApontou();
    if (idTela === 'dashboard') carregarProgramacoesParaApontamento();
    if (idTela === 'moinhoIdeias') {
        fecharFormularioMoinhoIdeias();
        carregarListaMoinhoIdeias();
    }
}

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

function atualizarNomeUsuario() {
    const nome = estado.perfil?.nome_completo || estado.usuario?.email || 'Usuário';
    const headerNome = document.getElementById('header-nome-usuario');
    const menuNome = document.getElementById('menu-nome-usuario');
    if (headerNome) headerNome.textContent = nome;
    if (menuNome) menuNome.textContent = nome;
}

document.getElementById('btn-meus-dados')?.addEventListener('click', async () => {
    const p = estado.perfil;
    if (!p) return;
    const nasc = p.data_nascimento || p.nascimento ? new Date(p.data_nascimento + 'T12:00:00').toISOString().slice(0, 10) : '';

    const fotoTopo = p.foto_url
        ? `<div style="text-align:center;margin-bottom:12px;"><img src="${String(p.foto_url).replace(/"/g, '&quot;')}" alt="" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #004175;box-shadow:0 4px 14px rgba(0,65,117,0.2);"></div>`
        : '';
    const result = await Swal.fire({
        title: 'Meus Dados de Cadastro',
        html: `
            ${fotoTopo}
            <div style="text-align: left; font-size: 0.95rem;">
                <p style="margin: 8px 0;"><strong>Nome:</strong> ${(p.nome_completo || '—').replace(/</g, '&lt;')}</p>
                <p style="margin: 8px 0;"><strong>Email:</strong> ${(p.email || '—').replace(/</g, '&lt;')}</p>
                <p style="margin: 8px 0;"><strong>CPF:</strong> ${p.cpf ? p.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '—'}</p>
                <p style="margin: 8px 0;"><strong>Departamento:</strong> ${(p.tag || '—').replace(/</g, '&lt;')}</p>
                <p style="margin: 8px 0;"><strong>Data de nascimento:</strong> ${nasc ? new Date(nasc + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</p>
                <p style="margin: 8px 0;"><strong>Função:</strong> ${p.funcao === 'admin' ? 'Administrador' : 'Usuário'}</p>
            </div>
        `,
        showDenyButton: true,
        confirmButtonText: 'Fechar',
        denyButtonText: 'Editar',
        confirmButtonColor: '#004175',
        denyButtonColor: '#666'
    });

    if (result.isDenied) {
        const { value: form } = await Swal.fire({
            title: 'Editar Meus Dados',
            html: `
                <div style="text-align:left;">
                    <label style="display:block;margin-bottom:4px;font-weight:600;">Nome Completo</label>
                    <input type="text" id="edit-nome" class="swal2-input" value="${(p.nome_completo || '').replace(/"/g, '&quot;')}" style="margin-bottom:1rem;">
                    <label style="display:block;margin-bottom:4px;font-weight:600;">CPF (apenas números)</label>
                    <input type="text" id="edit-cpf" class="swal2-input" value="${(p.cpf || '').replace(/"/g, '&quot;')}" placeholder="00000000000" style="margin-bottom:1rem;">
                    <label style="display:block;margin-bottom:4px;font-weight:600;">Email</label>
                    <input type="email" id="edit-email" class="swal2-input" value="${(p.email || '').replace(/"/g, '&quot;')}" style="margin-bottom:1rem;">
                    <label style="display:block;margin-bottom:4px;font-weight:600;">Departamento</label>
                    <select id="edit-tag" class="swal2-input" style="margin-bottom:1rem;">
                        <option value="Elétrica" ${p.tag === 'Elétrica' ? 'selected' : ''}>Elétrica</option>
                        <option value="Mecânica" ${p.tag === 'Mecânica' ? 'selected' : ''}>Mecânica</option>
                        <option value="Automação" ${p.tag === 'Automação' ? 'selected' : ''}>Automação</option>
                    </select>
                    <label style="display:block;margin-bottom:4px;font-weight:600;">Data de Nascimento</label>
                    <input type="date" id="edit-nasc" class="swal2-input" value="${nasc}" style="margin-bottom:1rem;">
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Salvar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#004175',
            preConfirm: () => ({
                nome_completo: document.getElementById('edit-nome').value?.trim() || '',
                cpf: document.getElementById('edit-cpf').value?.replace(/\D/g, '') || '',
                email: document.getElementById('edit-email').value?.trim() || '',
                tag: document.getElementById('edit-tag').value || '',
                data_nascimento: document.getElementById('edit-nasc').value || null
            })
        });

        if (form && form.nome_completo) {
            try {
                const { error } = await supabase.from('perfis').update({
                    nome_completo: form.nome_completo,
                    cpf: form.cpf || null,
                    email: form.email || null,
                    tag: form.tag || null,
                    data_nascimento: form.data_nascimento || null
                }).eq('id', estado.usuario.id);
                if (error) throw error;
                estado.perfil = { ...estado.perfil, ...form };
                atualizarNomeUsuario();
                Toast.fire({ icon: 'success', title: 'Dados atualizados!' });
            } catch (e) {
                mostrarErro('Erro', e.message || 'Não foi possível salvar.');
            }
        }
    }
});

document.getElementById('alternar-menu').addEventListener('click', () => {
    menuMobile.classList.remove('oculto');
    lucide.createIcons();
});
document.getElementById('fechar-menu').addEventListener('click', () => menuMobile.classList.add('oculto'));

document.getElementById('nav-inicio')?.addEventListener('click', () => navegarParaInicio());
document.getElementById('nav-operacao-inicio')?.addEventListener('click', () => navegarParaInicio());
document.getElementById('nav-historico').addEventListener('click', () => navegarPara('historico'));
document.getElementById('nav-admin').addEventListener('click', () => navegarPara('admin'));
document.getElementById('admin-tab-painel')?.addEventListener('click', () => setAdminTab('painel'));
document.getElementById('admin-tab-relatorio-os')?.addEventListener('click', () => setAdminTab('relatorio'));
document.getElementById('btn-menu-relatorio-os-abertas')?.addEventListener('click', () => navegarPara('admin', { adminTab: 'relatorio' }));
document.getElementById('nav-relatorio-os-abertas')?.addEventListener('click', () => {
    navegarPara('admin', { adminTab: 'relatorio' });
    if (menuMobile) menuMobile.classList.add('oculto');
});
document.getElementById('nav-ordens-servico')?.addEventListener('click', () => navegarPara('gestaoOs'));
document.getElementById('nav-hora-extra')?.addEventListener('click', () => navegarPara('horaExtra'));
document.getElementById('nav-veiculos')?.addEventListener('click', () => navegarPara('veiculos'));
document.getElementById('nav-programacao')?.addEventListener('click', () => navegarPara('programacao'));
document.getElementById('nav-calendario')?.addEventListener('click', () => navegarPara('calendario'));
document.getElementById('nav-programar')?.addEventListener('click', () => navegarPara('programar'));
document.getElementById('nav-programar-calendario')?.addEventListener('click', () => navegarPara('calendarioAdmin'));
document.getElementById('nav-quem-nao-apontou')?.addEventListener('click', () => navegarPara('quemNaoApontou'));
document.getElementById('nav-sair').addEventListener('click', async () => {
    await supabase.auth.signOut();
    estado.usuario = null;
    estado.perfil = null;
    estado.equipamentosExtrasMap = null;
    estado.equipamentosPendentesMap = null;
    estado.equipOpUnidadePreselect = null;
    estado.adminPerfisLista = null;
    document.getElementById('nav-admin')?.classList.add('oculto');
    document.getElementById('nav-ordens-servico')?.classList.add('oculto');
    document.getElementById('nav-hora-extra')?.classList.add('oculto');
    document.getElementById('nav-programar')?.classList.add('oculto');
    document.getElementById('nav-programar-calendario')?.classList.add('oculto');
    document.getElementById('nav-quem-nao-apontou')?.classList.add('oculto');
    document.getElementById('menu-usuario').classList.remove('oculto');
    document.getElementById('menu-admin').classList.add('oculto');
    navegarPara('login');
});

document.getElementById('btn-ir-cadastro-manutencao')?.addEventListener('click', () => navegarPara('cadastro'));
document.getElementById('btn-ir-cadastro-operacao')?.addEventListener('click', () => {
    preencherSelectsCadastroOperacao();
    navegarPara('cadastroOperacao');
});
document.getElementById('btn-voltar-login').addEventListener('click', () => navegarPara('login'));
document.getElementById('btn-voltar-login-operacao')?.addEventListener('click', () => navegarPara('login'));

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
    popularSelectSetoresMT('apt-setor-centro', 'Selecione o setor (código)…');
    definirBloqueioEquipamentoApontamento(false);
    setEstadoFinalizadoApontamento(null);
    definirCabecalhoApontamentoNovo();
    const btnSubmit = document.querySelector('#formulario-apontamento button[type="submit"]');
    if (btnSubmit) {
        btnSubmit.innerHTML = '<i data-lucide="check-circle"></i> SALVAR APONTAMENTO';
        btnSubmit.dataset.modo = '';
    }
    mostrarOcultarAptOrdemManual();
    void atualizarEquipamentosApontamento('');
    atualizarVisibilidadeCamposAdmin();
    navegarPara('dashboard');
});
document.getElementById('btn-menu-apontamentos').addEventListener('click', () => {
    apontamentoEditando = null;
    document.getElementById('formulario-apontamento').reset();
    popularSelectSetoresMT('apt-setor-centro', 'Selecione o setor (código)…');
    definirBloqueioEquipamentoApontamento(false);
    setEstadoFinalizadoApontamento(null);
    definirCabecalhoApontamentoNovo();
    const btnSubmit = document.querySelector('#formulario-apontamento button[type="submit"]');
    if (btnSubmit) {
        btnSubmit.innerHTML = '<i data-lucide="check-circle"></i> SALVAR APONTAMENTO';
        btnSubmit.dataset.modo = '';
    }
    mostrarOcultarAptOrdemManual();
    void atualizarEquipamentosApontamento('');
    atualizarVisibilidadeCamposAdmin();
    navegarPara('dashboard');
});
document.getElementById('btn-menu-historico').addEventListener('click', () => navegarPara('historico'));
document.getElementById('btn-voltar-historico')?.addEventListener('click', () => navegarParaInicio());
document.getElementById('btn-menu-admin').addEventListener('click', () => navegarPara('admin'));
document.getElementById('btn-menu-ordens-servico')?.addEventListener('click', () => navegarPara('gestaoOs'));
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
document.getElementById('btn-menu-calendario')?.addEventListener('click', () => navegarPara('calendario'));
document.getElementById('btn-menu-programar-admin')?.addEventListener('click', () => navegarPara('programar'));
document.getElementById('btn-menu-programar-calendario-admin')?.addEventListener('click', () => navegarPara('calendarioAdmin'));
document.getElementById('btn-menu-quem-nao-apontou')?.addEventListener('click', () => navegarPara('quemNaoApontou'));

registrarVoltarInicio(
    'btn-voltar-menu',
    'btn-voltar-menu-bh',
    'btn-voltar-menu-he',
    'btn-voltar-menu-ferias',
    'btn-voltar-menu-veiculos',
    'btn-voltar-menu-programar',
    'btn-voltar-menu-programacao',
    'btn-voltar-menu-calendario',
    'btn-voltar-menu-calendario-admin',
    'btn-voltar-menu-quem-nao-apontou',
    'btn-voltar-gestao-os',
    'btn-voltar-admin',
    'btn-voltar-menu-operacao',
    'btn-voltar-menu-solicitacoes',
    'btn-voltar-equipamentos-operacao',
    'btn-voltar-menu-moinho',
    'btn-voltar-menu-preventivas'
);

document.getElementById('nav-abrir-os')?.addEventListener('click', () => navegarPara('abrirOs'));
document.getElementById('nav-minhas-solicitacoes')?.addEventListener('click', () => navegarPara('minhasSolicitacoes'));
document.getElementById('btn-operacao-abrir-os')?.addEventListener('click', () => navegarPara('abrirOs'));
document.getElementById('btn-operacao-minhas-solicitacoes')?.addEventListener('click', () => navegarPara('minhasSolicitacoes'));


async function verificarUsuario() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        estado.usuario = session.user;

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
                await new Promise(r => setTimeout(r, 500));
            }
        }

        if (perfilEncontrado) {
            estado.perfil = perfilEncontrado;
            void carregarEquipamentosExtrasSupabase();
            void carregarEquipamentosPendentesSupabase();
            atualizarNomeUsuario();
            await navegarParaInicio();
        } else {
            console.error('Perfil não encontrado após retentativas.');
            await navegarPara('dashboard');
            mostrarErro('Perfil Em Processamento', 'Seus dados ainda estão sendo processados. Recarregue a página em instantes.');
        }
    } else {
        await navegarPara('login');
    }
}

function definirModoLogin(modo) {
    const hid = document.getElementById('login-modo');
    const label = document.getElementById('login-campo-label');
    const input = document.getElementById('login-email');
    const btnManut = document.getElementById('btn-login-manutencao');
    const btnOper = document.getElementById('btn-login-operacao');
    if (!hid || !label || !input) return;

    const isOperacao = modo === 'email';
    hid.value = isOperacao ? 'email' : 'nome';
    label.textContent = isOperacao ? 'Login (cadastro operação)' : 'Login (manutenção)';
    input.placeholder = isOperacao
        ? 'Email cadastrado no perfil'
        : 'Nome, e-mail ou número cadastrado no perfil';
    input.type = 'text';
    input.autocomplete = 'username';

    btnManut?.classList.toggle('login-modo-btn--ativo', !isOperacao);
    btnManut?.setAttribute('aria-selected', String(!isOperacao));
    btnOper?.classList.toggle('login-modo-btn--ativo', isOperacao);
    btnOper?.setAttribute('aria-selected', String(isOperacao));
}

document.getElementById('btn-login-manutencao')?.addEventListener('click', () => definirModoLogin('nome'));
document.getElementById('btn-login-operacao')?.addEventListener('click', () => definirModoLogin('email'));

document.getElementById('formulario-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputLogin = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;
    const modoEmail = document.getElementById('login-modo')?.value === 'email';

    let email = inputLogin;

    if (modoEmail) {
        if (!inputLogin.includes('@')) {
            mostrarErro('Falha no Login', 'Informe o login no formato do cadastro (e-mail corporativo).');
            return;
        }
        const { data: porEmail, error: errEmail } = await supabase
            .from('perfis')
            .select('email, cpf')
            .eq('email', inputLogin.trim())
            .maybeSingle();
        if (errEmail || !porEmail) {
            mostrarErro('Falha no Login', 'Login não encontrado no cadastro.');
            return;
        }
        email = porEmail.email && String(porEmail.email).includes('@')
            ? porEmail.email
            : emailTecnicoPorCpf(porEmail.cpf);
        if (!email) {
            mostrarErro('Falha no Login', 'Não foi possível identificar o e-mail técnico de acesso.');
            return;
        }
    } else {
        const raw = inputLogin.trim();
        let perfilData = null;
        const rawNumero = normalizarNumeroWhatsapp(raw);

        if (raw.includes('@')) {
            const { data: listMail, error: errMail } = await supabase
                .from('perfis')
                .select('email, nome_completo, cpf')
                .ilike('email', raw)
                .limit(2);
            if (errMail) {
                mostrarErro('Falha no Login', 'Erro ao consultar o cadastro. Tente novamente.');
                return;
            }
            if (listMail?.length === 1 && listMail[0].email) {
                perfilData = listMail[0];
            } else if (listMail && listMail.length > 1) {
                mostrarErro('Falha no Login', 'E-mail ambíguo. Use o mesmo endereço cadastrado no perfil.');
                return;
            }
        }

        if (!perfilData) {
            const { data: perfisData, error: perfilError } = await supabase
                .from('perfis')
                .select('email, nome_completo, cpf')
                .ilike('nome_completo', `%${raw}%`)
                .limit(20);

            if (perfilError || !perfisData || perfisData.length === 0) {
                mostrarErro('Falha no Login', 'Login não encontrado. Use o nome completo, e-mail ou número cadastrado.');
                return;
            }

            const rawNormalizado = normalizarTextoBusca(raw);
            perfilData = perfisData.find((p) => normalizarTextoBusca(p.nome_completo) === rawNormalizado);
            if (!perfilData && perfisData.length === 1) {
                perfilData = perfisData[0];
            } else if (!perfilData && perfisData.length > 1) {
                mostrarErro(
                    'Falha no Login',
                    'Vários perfis correspondem. Digite o e-mail cadastrado ou o nome completo exatamente como no cadastro.'
                );
                return;
            }
        }

        if (!perfilData && rawNumero) {
            const { data: porNumero, error: errNumero } = await supabase
                .from('perfis')
                .select('email, nome_completo, cpf')
                .or(`telefone.eq.${rawNumero},email.eq.${rawNumero},cpf.eq.${rawNumero}`)
                .maybeSingle();
            if (!errNumero && porNumero) {
                perfilData = porNumero;
            }
        }

        if (!perfilData) {
            mostrarErro('Falha no Login', 'Login não encontrado. Use o nome completo, e-mail ou número cadastrado.');
            return;
        }

        email = perfilData.email && String(perfilData.email).includes('@')
            ? perfilData.email
            : emailTecnicoPorCpf(perfilData.cpf);
        if (!email) {
            mostrarErro('Falha no Login', 'Não foi possível identificar o e-mail técnico de acesso.');
            return;
        }
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });

    if (error) {
        mostrarErro('Falha no Login', 'Email ou senha incorretos.');
        return;
    }

    if (data && data.user) {
        Toast.fire({ icon: 'success', title: 'Login realizado com sucesso' });
        await verificarUsuario();
    }
});

function preencherSelectsCadastroOperacao() {
    const setor = document.getElementById('cad-op-setor');
    if (setor && setor.options.length <= 1) {
        setor.innerHTML = '<option value="">Selecione...</option>';
        UNIDADES_OPERACAO.forEach(u => { const o = document.createElement('option'); o.value = u; o.textContent = u; setor.appendChild(o); });
    }
    popularSelectSetoresMT('cad-op-setor-centro', 'Selecione se quiser gravar como padrão…');
}

document.getElementById('formulario-cadastro').addEventListener('submit', async (e) => {
    e.preventDefault();

    const whatsappInput = document.getElementById('cad-whatsapp').value.trim();
    const whatsapp = normalizarNumeroWhatsapp(whatsappInput);
    const senha = document.getElementById('cad-senha').value;
    const cpf = document.getElementById('cad-cpf').value.replace(/\D/g, '');
    const email = document.getElementById('cad-email')?.value?.trim().toLowerCase();
    if (!whatsapp || whatsapp.length < 10) {
        mostrarErro('Cadastro', 'Informe um número de WhatsApp válido com DDD.');
        return;
    }
    if (!email || !email.includes('@')) {
        mostrarErro('Cadastro', 'Informe um e-mail válido para cadastro.');
        return;
    }

    const metaData = {
        nome_completo: document.getElementById('cad-nome').value.trim(),
        cpf,
        email,
        data_nascimento: document.getElementById('cad-nasc').value,
        tag: document.getElementById('cad-tag').value,
        whatsapp,
        telefone: whatsapp,
        tipo_perfil: 'manutencao'
    };

    Swal.fire({
        title: 'Criando conta...',
        text: 'Aguarde...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    const { data, error } = await criarContaAuthComFallback(email, senha, metaData);

    Swal.close();

    if (error) {
        mostrarErro('Erro no Cadastro', mensagemErroCadastroAuth(error));
        return;
    }

    if (data.user) {
        const { error: perfErr } = await atualizarPerfilCadastro(data.user.id, {
            tipo_perfil: 'manutencao',
            email,
            telefone: whatsapp,
            cpf
        });
        if (perfErr) {
            mostrarErro('Perfil', perfErr.message || 'Não foi possível salvar CPF/e-mail no perfil.');
            return;
        }
        const fotoEl = document.getElementById('cad-foto');
        if (data.session && fotoEl?.files?.length) {
            try {
                const file = fotoEl.files[0];
                const nomeLimpo = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
                const path = `perfis/${data.user.id}/${Date.now()}_${nomeLimpo}`;
                const { error: uploadError } = await supabase.storage.from('fotos_apontamentos').upload(path, file);
                if (!uploadError) {
                    const { data: urlData } = supabase.storage.from('fotos_apontamentos').getPublicUrl(path);
                    await supabase.from('perfis').update({ foto_url: urlData.publicUrl }).eq('id', data.user.id);
                }
            } catch (err) {
                console.warn('Foto não enviada:', err);
            }
        }
        if (data.session) {
            mostrarSucesso('Conta criada com sucesso!');
            await verificarUsuario();
        } else {
            Swal.fire({ icon: 'info', title: 'Conta Criada', text: 'Você já pode fazer login!' }).then(() => navegarPara('login'));
        }
    }
});

(function initCadastroFotoPreview() {
    const input = document.getElementById('cad-foto');
    const prev = document.getElementById('cad-foto-preview');
    const ph = document.getElementById('cad-foto-placeholder');
    const limparBtn = document.getElementById('cad-foto-limpar');
    input?.addEventListener('change', () => {
        const f = input.files?.[0];
        if (!f) return;
        const url = URL.createObjectURL(f);
        if (prev) {
            prev.src = url;
            prev.classList.remove('oculto');
        }
        ph?.classList.add('oculto');
        limparBtn?.classList.remove('oculto');
        lucide.createIcons();
    });
    limparBtn?.addEventListener('click', () => {
        input.value = '';
        if (prev) {
            prev.src = '';
            prev.classList.add('oculto');
        }
        ph?.classList.remove('oculto');
        limparBtn.classList.add('oculto');
        lucide.createIcons();
    });
})();

['apt-manutentor', 'apt-data', 'apt-inicio', 'apt-fim'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
        clearTimeout(limiteDiaTimer);
        limiteDiaTimer = setTimeout(() => atualizarIndicadorLimiteDia(), 150);
    });
});

document.getElementById('formulario-cadastro-operacao')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('cad-op-email').value.trim().toLowerCase();
    const senha = document.getElementById('cad-op-senha').value;
    const nome = document.getElementById('cad-op-nome').value.trim();
    const telefone = document.getElementById('cad-op-telefone').value.trim();
    const setorUnidade = document.getElementById('cad-op-setor').value;
    const setorCentroPadrao = document.getElementById('cad-op-setor-centro')?.value?.trim() || null;
    const funcao_cargo = document.getElementById('cad-op-funcao').value.trim();

    Swal.fire({ title: 'Criando conta...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const { data, error } = await criarContaAuthComFallback(email, senha, {
        nome_completo: nome,
        email,
        telefone: telefone || null,
        setor: setorUnidade || null,
        unidade: setorUnidade || null,
        funcao_cargo: funcao_cargo || null,
        setor_centro_padrao: setorCentroPadrao,
        tipo_perfil: 'operacao'
    });
    Swal.close();
    if (error) {
        mostrarErro('Erro no Cadastro', mensagemErroCadastroAuth(error));
        return;
    }
    if (data.user) {
        const perfilUpd = {
            tipo_perfil: 'operacao',
            nome_completo: nome,
            email,
            telefone: telefone || null,
            setor: setorUnidade || null,
            unidade: setorUnidade || null,
            funcao_cargo: funcao_cargo || null,
            setor_centro_padrao: setorCentroPadrao
        };
        let { error: perfErr } = await atualizarPerfilCadastro(data.user.id, perfilUpd, ['setor_centro_padrao']);
        if (perfErr) {
            mostrarErro('Perfil', perfErr.message || 'Não foi possível atualizar o perfil.');
            return;
        }
        if (data.session) {
            mostrarSucesso('Conta criada!');
            await verificarUsuario();
        } else {
            Swal.fire({ icon: 'info', title: 'Conta Criada', text: 'Você já pode fazer login!' }).then(() => navegarPara('login'));
        }
    }
});

function numerosInteirosAPartirDeCampo(rows, getValor) {
    const out = [];
    for (const row of rows || []) {
        const s = String(getValor(row) || '').trim();
        if (/^\d+$/.test(s)) {
            const n = parseInt(s, 10);
            if (!isNaN(n) && n >= 1) out.push(n);
        }
    }
    return out;
}

async function obterProximoNumeroOrdemUnico() {
    try {
        const { data: rpcN, error: rpcErr } = await supabase.rpc('proximo_numero_ordem');
        if (!rpcErr && rpcN != null && String(rpcN).trim() !== '') {
            const s = String(rpcN).trim();
            if (/^\d+$/.test(s)) return s.padStart(4, '0');
            return s;
        }
    } catch (_) {
        /* RPC ausente ou sem permissão — fallback abaixo */
    }
    try {
        const [{ data: osRows }, { data: aptRows }, { data: progRows }] = await Promise.all([
            supabase.from('ordens_servico').select('numero_solicitacao'),
            supabase.from('apontamentos').select('numero_ordem'),
            supabase.from('programacoes').select('os_numero')
        ]);
        const todos = [
            ...numerosInteirosAPartirDeCampo(osRows, (r) => r.numero_solicitacao),
            ...numerosInteirosAPartirDeCampo(aptRows, (r) => r.numero_ordem),
            ...numerosInteirosAPartirDeCampo(progRows, (r) => r.os_numero)
        ];
        const max = todos.length ? Math.max(...todos) : 0;
        return String(max + 1).padStart(4, '0');
    } catch (_) {
        return '0001';
    }
}

async function obterProximoNumeroOS() {
    return obterProximoNumeroOrdemUnico();
}

function filtroApontamentosPorUsuarioOuManutentor(uid) {
    if (!uid) return '';
    return `id_usuario.eq.${uid},id_manutentor.eq.${uid}`;
}

/** Alinha nº de OS entre apontamentos, programações e ordens_servico (ex.: 1 vs 0001). */
function variantesNumeroOs(n) {
    const s = String(n ?? '').trim();
    if (!s) return [];
    const out = new Set([s]);
    if (/^\d+$/.test(s)) {
        const num = parseInt(s, 10);
        out.add(String(num));
        out.add(String(num).padStart(4, '0'));
        if (s.length < 4) out.add(s.padStart(4, '0'));
    }
    return [...out];
}

/** Quando o apontamento marca serviço concluído, encerra a OS correspondente (se existir no cadastro). */
async function encerrarOrdemServicoSeConcluido(numeroOrdem, concluido) {
    if (!concluido || !numeroOrdem) return;
    for (const v of variantesNumeroOs(numeroOrdem)) {
        const { data, error } = await supabase
            .from('ordens_servico')
            .update({ status: 'concluida', atualizado_em: new Date().toISOString() })
            .eq('numero_solicitacao', v)
            .neq('status', 'cancelada')
            .select('id');
        if (!error && data?.length) return;
    }
}

/** Oculta programações cuja OS já está concluída ou cancelada (evita novo apontamento na mesma OS). */
async function filtrarProgramacoesOsAindaAbertas(programacoes) {
    const prog = programacoes || [];
    const nums = [...new Set(prog.map((p) => p.os_numero).filter(Boolean))];
    if (nums.length === 0) return prog;
    const todasVariantes = [...new Set(nums.flatMap(variantesNumeroOs))];
    const { data: ordens, error } = await supabase
        .from('ordens_servico')
        .select('numero_solicitacao, status')
        .in('numero_solicitacao', todasVariantes);
    if (error || !ordens?.length) return prog;
    const fechadas = new Set();
    for (const o of ordens) {
        if (o.status === 'concluida' || o.status === 'cancelada') {
            variantesNumeroOs(o.numero_solicitacao).forEach((x) => fechadas.add(x));
        }
    }
    return prog.filter((p) => {
        const vs = variantesNumeroOs(p.os_numero);
        return !vs.some((x) => fechadas.has(x));
    });
}

function definirCabecalhoApontamentoNovo() {
    const h = document.getElementById('tela-dashboard-titulo');
    const s = document.getElementById('tela-dashboard-subtitulo');
    if (h) h.textContent = 'Apontamento de serviço';
    if (s) {
        s.textContent =
            'Selecione a OS programada, preencha horários e informe se o trabalho foi concluído. Ao marcar «Sim» em concluído, a OS é encerrada e some das listas em aberto.';
        s.classList.remove('oculto');
        s.style.display = '';
    }
}

function definirCabecalhoApontamentoEdicao() {
    const h = document.getElementById('tela-dashboard-titulo');
    const s = document.getElementById('tela-dashboard-subtitulo');
    if (h) h.textContent = 'Editar apontamento';
    if (s) {
        s.classList.add('oculto');
        s.style.display = 'none';
    }
}

async function preencherNumeroOrdemApontamentoAutomatico() {
    const manualInput = document.getElementById('apt-ordem-manual');
    if (!manualInput) return;
    manualInput.value = '…';
    const n = await obterProximoNumeroOrdemUnico();
    manualInput.value = n;
    manualInput.readOnly = true;
}

function adicionarOpcaoEquipamentoNaoNaListaAbrirOS(equipamentoSel) {
    const opt = document.createElement('option');
    opt.value = VALOR_OS_EQUIP_NAO_NA_LISTA;
    opt.textContent = 'Não se encontra nesta lista';
    opt.className = 'os-equip-opcao-nao-listado';
    equipamentoSel.appendChild(opt);
}

async function atualizarEquipamentosAbrirOS(unidade) {
    await carregarEquipamentosExtrasSupabase();
    const equipamentoSel = document.getElementById('os-equipamento');
    if (!equipamentoSel) return;
    const lista = obterListaEquipamentosParaUnidade(unidade);
    equipamentoSel.innerHTML = '';
    if (!unidade) {
        equipamentoSel.disabled = true;
        equipamentoSel.required = false;
        equipamentoSel.innerHTML = '<option value="">Selecione primeiro a unidade</option>';
        return;
    }
    equipamentoSel.disabled = false;
    equipamentoSel.required = true;
    equipamentoSel.innerHTML = '<option value="">Selecione o equipamento</option>';
    lista.forEach((eq) => {
        const opt = document.createElement('option');
        opt.value = eq;
        opt.textContent = eq;
        equipamentoSel.appendChild(opt);
    });
    adicionarOpcaoEquipamentoNaoNaListaAbrirOS(equipamentoSel);
}

async function preencherSelectsAbrirOS() {
    const setorSel = document.getElementById('os-setor');
    if (setorSel && setorSel.options.length <= 1) {
        setorSel.innerHTML = '<option value="">Selecione a unidade</option>';
        UNIDADES_OPERACAO.forEach(u => { const o = document.createElement('option'); o.value = u; o.textContent = u; setorSel.appendChild(o); });
    }
    if (estado.perfil?.setor) setorSel.value = estado.perfil.setor;
    popularSelectSetoresMT('os-setor-centro', 'Selecione o setor (código / centro)…');
    const sc = document.getElementById('os-setor-centro');
    if (sc && estado.perfil?.setor_centro_padrao && SETORES.includes(estado.perfil.setor_centro_padrao)) {
        sc.value = estado.perfil.setor_centro_padrao;
    }
    await atualizarEquipamentosAbrirOS(setorSel?.value || '');
    obterProximoNumeroOS().then(num => {
        const campo = document.getElementById('os-numero');
        if (campo) campo.value = num;
    });
}

document.getElementById('os-setor')?.addEventListener('change', (e) => {
    void atualizarEquipamentosAbrirOS(e.target.value || '');
});

async function preencherTelaEquipamentosOperacao() {
    const sel = document.getElementById('equip-op-unidade');
    const lista = document.getElementById('equip-op-lista');
    const inpNovo = document.getElementById('equip-op-novo-nome');
    const btnAdd = document.getElementById('equip-op-btn-adicionar');
    if (!sel || !lista) return;
    if (sel.options.length <= 1) {
        sel.innerHTML = '<option value="">Selecione a unidade</option>';
        UNIDADES_OPERACAO.forEach((u) => {
            const o = document.createElement('option');
            o.value = u;
            o.textContent = u;
            sel.appendChild(o);
        });
    }

    const optionValues = () => [...sel.options].map((o) => o.value).filter(Boolean);
    if (estado.equipOpUnidadePreselect && optionValues().includes(estado.equipOpUnidadePreselect)) {
        sel.value = estado.equipOpUnidadePreselect;
        estado.equipOpUnidadePreselect = null;
    } else if (estado.perfil?.setor && optionValues().includes(estado.perfil.setor)) {
        sel.value = estado.perfil.setor;
    }

    const sincronizarSelectsOutrasTelas = async (u) => {
        const osSetor = document.getElementById('os-setor')?.value;
        if (osSetor && u === osSetor) await atualizarEquipamentosAbrirOS(osSetor);
        const aptU = document.getElementById('apt-unidade')?.value;
        if (aptU && u === aptU) await atualizarEquipamentosApontamento(aptU);
    };

    const render = async () => {
        lista.innerHTML = '<p class="equip-op-vazio">Carregando lista…</p>';
        const u = sel.value;
        if (!u) {
            lista.innerHTML = '<p class="equip-op-vazio">Selecione uma unidade.</p>';
            return;
        }
        await carregarEquipamentosExtrasSupabase();
        await carregarEquipamentosPendentesSupabase();
        const itens = obterListaEquipamentosParaUnidade(u);
        const idPorNomeLower = new Map(
            obterLinhasExtrasUnidade(u).map((L) => [String(L.nome).trim().toLowerCase(), L.id])
        );
        const nomesItensLower = new Set(itens.map((x) => String(x).trim().toLowerCase()));
        const linhasPend = obterLinhasPendentesUnidade(u);
        const pendentesSozinhos = linhasPend.filter((p) => !nomesItensLower.has(String(p.nome).trim().toLowerCase()));
        const ehAdmin = estado.perfil?.funcao === 'admin';
        const uid = estado.usuario?.id;

        let blocoPrincipal = '';
        if (itens.length === 0) {
            blocoPrincipal =
                '<p class="equip-op-vazio">Nenhum equipamento na lista padrão para esta unidade. Envie o nome abaixo; após aprovação do administrador, o item passa a aparecer aqui e em <strong>Abrir OS</strong>.</p>';
        } else {
            blocoPrincipal = `<ul class="equip-op-ul">${itens
                .map((i) => {
                    const esc = String(i).replace(/</g, '&lt;');
                    const idEx = idPorNomeLower.get(String(i).trim().toLowerCase());
                    const isExtra = Boolean(idEx);
                    const tagExtra = isExtra ? ' <span class="equip-op-tag-extra">cadastro extra</span>' : '';
                    const btnEx = idEx
                        ? `<button type="button" class="equip-op-btn-excluir btn btn-outline btn-sm" data-id="${String(idEx).replace(/"/g, '')}" title="Remover do banco (todos os usuários)">Excluir</button>`
                        : '';
                    return `<li class="equip-op-li equip-op-li-linha${isExtra ? ' equip-op-li--extra' : ''}"><span class="equip-op-li-texto">${esc}${tagExtra}</span>${btnEx}</li>`;
                })
                .join('')}</ul>`;
        }

        let blocoPend = '';
        if (pendentesSozinhos.length > 0) {
            blocoPend = `<p class="equip-op-subtitulo-pend"><i data-lucide="clock"></i> Aguardando aprovação do administrador</p><ul class="equip-op-ul equip-op-ul--pend">${pendentesSozinhos
                .map((p) => {
                    const esc = String(p.nome).replace(/</g, '&lt;');
                    const podeCancelar = ehAdmin || (uid && p.id_solicitante === uid);
                    const btnCanc = podeCancelar
                        ? `<button type="button" class="equip-op-btn-cancelar-sol btn btn-outline btn-sm" data-pend-id="${String(p.id).replace(/"/g, '')}" title="Cancelar solicitação" style="color:#b45309;border-color:#fed7aa;">Cancelar pedido</button>`
                        : '';
                    return `<li class="equip-op-li equip-op-li-linha equip-op-li--pendente"><span class="equip-op-li-texto">${esc} <span class="equip-op-tag-pendente">pendente</span></span>${btnCanc}</li>`;
                })
                .join('')}</ul>`;
        }

        lista.innerHTML = blocoPrincipal + blocoPend;

        lista.querySelectorAll('.equip-op-btn-excluir').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                const { isConfirmed } = await Swal.fire({
                    icon: 'warning',
                    title: 'Remover equipamento?',
                    text: 'O item será excluído do banco e some da lista para todos os usuários.',
                    showCancelButton: true,
                    confirmButtonText: 'Sim, remover',
                    cancelButtonText: 'Cancelar',
                    confirmButtonColor: '#b91c1c'
                });
                if (!isConfirmed || !id) return;
                const ok = await excluirEquipamentoExtraPorId(id);
                if (!ok) return;
                mostrarSucesso('Equipamento removido.');
                await render();
                await sincronizarSelectsOutrasTelas(sel.value);
                lucide.createIcons();
            });
        });

        lista.querySelectorAll('.equip-op-btn-cancelar-sol').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-pend-id');
                const { isConfirmed } = await Swal.fire({
                    icon: 'warning',
                    title: 'Cancelar solicitação?',
                    text: 'O pedido de inclusão será retirado da fila do administrador.',
                    showCancelButton: true,
                    confirmButtonText: 'Sim, cancelar',
                    cancelButtonText: 'Voltar',
                    confirmButtonColor: '#b91c1c'
                });
                if (!isConfirmed || !id) return;
                const ok = await cancelarSolicitacaoEquipPorId(id);
                if (!ok) return;
                mostrarSucesso('Solicitação cancelada.');
                await render();
                await sincronizarSelectsOutrasTelas(sel.value);
                lucide.createIcons();
            });
        });
        lucide.createIcons();
    };

    sel.onchange = () => {
        void render();
    };
    await render();

    const aoIncluir = async () => {
        const u = sel.value;
        const nome = inpNovo?.value?.trim() || '';
        const r = await adicionarEquipamentoExtraNaUnidade(u, nome);
        if (!r.ok) {
            mostrarErro('Equipamento', r.msg);
            return;
        }
        if (inpNovo) inpNovo.value = '';
        if (r.modo === 'pendente') {
            mostrarSucesso('Solicitação enviada ao administrador.');
        } else {
            mostrarSucesso('Equipamento salvo no banco para esta unidade.');
        }
        await render();
        await sincronizarSelectsOutrasTelas(u);
        lucide.createIcons();
    };
    if (btnAdd && !btnAdd.dataset.boundEquipOp) {
        btnAdd.dataset.boundEquipOp = '1';
        btnAdd.addEventListener('click', () => void aoIncluir());
        inpNovo?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                void aoIncluir();
            }
        });
    }
}

document.getElementById('btn-operacao-ir-incluir-equip')?.addEventListener('click', () => navegarPara('equipamentosOperacao'));

document.getElementById('nav-equipamentos-operacao')?.addEventListener('click', () => navegarPara('equipamentosOperacao'));
document.getElementById('btn-operacao-equipamentos')?.addEventListener('click', () => navegarPara('equipamentosOperacao'));

const VALOR_SEM_EQUIPAMENTO_APONTAMENTO = 'Sem equipamento';

/** Valor interno do select Abrir OS; no banco grava-se TEXTO_OS_EQUIP_GRAVADO_NAO_LISTADO. */
const VALOR_OS_EQUIP_NAO_NA_LISTA = '__os_equip_nao_na_lista__';
const TEXTO_OS_EQUIP_GRAVADO_NAO_LISTADO = 'Não se encontra nesta lista';

function extrairSetorCentroDeSetorProgramado(setorRaw) {
    if (!setorRaw) return '';
    const m = String(setorRaw).match(/\s·\s(.+)$/);
    return m ? m[1].trim() : '';
}

async function buscarOrdemServicoPorNumero(numeroOs) {
    const variantes = variantesNumeroOs(numeroOs);
    if (!variantes.length) return null;
    const { data, error } = await supabase
        .from('ordens_servico')
        .select('setor_centro, equipamento, centro_trabalho, setor, unidade')
        .in('numero_solicitacao', variantes)
        .limit(1);
    if (error || !data?.length) return null;
    return data[0];
}

function garantirOpcaoEquipamentoApontamento(valor) {
    const equipamentoSel = document.getElementById('apt-equipamento');
    if (!equipamentoSel || !valor) return;
    if (![...equipamentoSel.options].some((o) => o.value === valor)) {
        const opt = document.createElement('option');
        opt.value = valor;
        opt.textContent = valor;
        equipamentoSel.appendChild(opt);
    }
    equipamentoSel.value = valor;
}

function definirBloqueioEquipamentoApontamento(bloqueado, valorPreservar = '') {
    const equipamentoSel = document.getElementById('apt-equipamento');
    if (!equipamentoSel) return;
    if (bloqueado) {
        if (valorPreservar) garantirOpcaoEquipamentoApontamento(valorPreservar);
        equipamentoSel.disabled = true;
        equipamentoSel.required = false;
        equipamentoSel.dataset.bloqueadoEdicao = '1';
        return;
    }
    delete equipamentoSel.dataset.bloqueadoEdicao;
}

async function preencherCamposDeOsProgramada(numeroOs, setorProgramadoRaw = '') {
    const asc = document.getElementById('apt-setor-centro');
    const centroSel = document.getElementById('apt-centro');
    const os = await buscarOrdemServicoPorNumero(numeroOs);
    const setorCentro = os?.setor_centro || extrairSetorCentroDeSetorProgramado(setorProgramadoRaw);

    if (asc && setorCentro) {
        if (SETORES.includes(setorCentro)) {
            asc.value = setorCentro;
        } else if (![...asc.options].some((o) => o.value === setorCentro)) {
            const opt = document.createElement('option');
            opt.value = setorCentro;
            opt.textContent = setorCentro;
            asc.appendChild(opt);
            asc.value = setorCentro;
        } else {
            asc.value = setorCentro;
        }
    }

    if (centroSel && os?.centro_trabalho) {
        const centro = String(os.centro_trabalho).trim();
        if ([...centroSel.options].some((o) => o.value === centro)) {
            centroSel.value = centro;
        }
    }

    if (!apontamentoEditando && os?.equipamento) {
        const equipamentoSel = document.getElementById('apt-equipamento');
        if (equipamentoSel && !equipamentoSel.dataset.bloqueadoEdicao) {
            garantirOpcaoEquipamentoApontamento(String(os.equipamento).trim());
        }
    }
}

async function atualizarEquipamentosApontamento(unidade) {
    await carregarEquipamentosExtrasSupabase();
    const equipamentoSel = document.getElementById('apt-equipamento');
    if (!equipamentoSel) return;
    const bloqueadoEdicao = equipamentoSel.dataset.bloqueadoEdicao === '1';
    const valorBloqueado = bloqueadoEdicao ? equipamentoSel.value : '';
    const lista = obterListaEquipamentosParaUnidade(unidade);
    equipamentoSel.innerHTML = '';
    delete equipamentoSel.dataset.equipamentoOpcional;
    if (!unidade) {
        equipamentoSel.disabled = true;
        equipamentoSel.required = false;
        equipamentoSel.innerHTML = '<option value="">Selecione primeiro a unidade</option>';
        if (bloqueadoEdicao && valorBloqueado) {
            garantirOpcaoEquipamentoApontamento(valorBloqueado);
            definirBloqueioEquipamentoApontamento(true, valorBloqueado);
        }
        return;
    }
    if (lista.length === 0) {
        equipamentoSel.disabled = bloqueadoEdicao;
        equipamentoSel.required = false;
        if (!bloqueadoEdicao) equipamentoSel.dataset.equipamentoOpcional = '1';
        if (bloqueadoEdicao && valorBloqueado) {
            garantirOpcaoEquipamentoApontamento(valorBloqueado);
            definirBloqueioEquipamentoApontamento(true, valorBloqueado);
            return;
        }
        const opt = document.createElement('option');
        opt.value = VALOR_SEM_EQUIPAMENTO_APONTAMENTO;
        opt.textContent = 'Sem equipamento na lista — pode apontar (ex.: CRE, repasse, serviço geral)';
        opt.selected = true;
        equipamentoSel.appendChild(opt);
        return;
    }
    equipamentoSel.disabled = bloqueadoEdicao;
    equipamentoSel.required = !bloqueadoEdicao;
    equipamentoSel.innerHTML = '<option value="">Selecione o equipamento</option>';
    lista.forEach((eq) => {
        const opt = document.createElement('option');
        opt.value = eq;
        opt.textContent = eq;
        equipamentoSel.appendChild(opt);
    });
    if (bloqueadoEdicao && valorBloqueado) {
        definirBloqueioEquipamentoApontamento(true, valorBloqueado);
    }
}

async function verificarSuporteCampoEquipamentoApontamento() {
    if (suporteCampoEquipamentoApontamento !== null) return suporteCampoEquipamentoApontamento;
    try {
        const { error } = await supabase.from('apontamentos').select('equipamento').limit(1);
        suporteCampoEquipamentoApontamento = !error || !String(error.message || '').toLowerCase().includes('column');
    } catch (_) {
        suporteCampoEquipamentoApontamento = false;
    }
    return suporteCampoEquipamentoApontamento;
}

async function verificarSuporteCampoSetorCentroApontamento() {
    if (suporteCampoSetorCentroApontamento !== null) return suporteCampoSetorCentroApontamento;
    try {
        const { error } = await supabase.from('apontamentos').select('setor_centro').limit(1);
        suporteCampoSetorCentroApontamento = !error || !String(error.message || '').toLowerCase().includes('column');
    } catch (_) {
        suporteCampoSetorCentroApontamento = false;
    }
    return suporteCampoSetorCentroApontamento;
}

document.getElementById('formulario-abrir-os')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const numeroSolicitacao = document.getElementById('os-numero').value.trim();
    const descricao = document.getElementById('os-descricao').value.trim();
    const setorUnidade = document.getElementById('os-setor').value;
    const setorCentro = document.getElementById('os-setor-centro')?.value?.trim() || '';
    const rawEquip = document.getElementById('os-equipamento')?.value?.trim() || '';
    const equipamentoOs =
        rawEquip === VALOR_OS_EQUIP_NAO_NA_LISTA ? TEXTO_OS_EQUIP_GRAVADO_NAO_LISTADO : rawEquip;
    const centroTrabalho = document.getElementById('os-centro-trabalho').value;
    const dataNecessidade = document.getElementById('os-data-necessidade').value || null;
    const destinoServico = document.getElementById('os-destino').value || null;
    const tipoManutencao = document.getElementById('os-tipo-manutencao').value || null;
    const prioridade = document.getElementById('os-prioridade').value || null;
    const anexoInput = document.getElementById('os-anexo');
    if (!setorUnidade) { mostrarErro('Campos obrigatórios', 'Selecione a unidade.'); return; }
    if (!setorCentro) { mostrarErro('Campos obrigatórios', 'Selecione o setor (código / centro MT).'); return; }
    if (!rawEquip) { mostrarErro('Campos obrigatórios', 'Selecione o equipamento.'); return; }
    if (!numeroSolicitacao) { mostrarErro('Campos obrigatórios', 'Número da OS não gerado. Aguarde ou reabra a tela.'); return; }
    if (!descricao || !descricao.trim()) { mostrarErro('Campos obrigatórios', 'Preencha a descrição do serviço.'); return; }
    let anexoUrl = null;
    if (anexoInput?.files?.length) {
        const file = anexoInput.files[0];
        const reader = new FileReader();
        anexoUrl = await new Promise((res) => {
            reader.onload = () => res(reader.result);
            reader.readAsDataURL(file);
        });
    }
    try {
        const payload = {
            numero_solicitacao: numeroSolicitacao,
            titulo: tituloSolicitacaoPadrao(numeroSolicitacao),
            id_solicitante: estado.usuario.id,
            descricao: descricao.trim(),
            setor: setorUnidade,
            unidade: setorUnidade,
            equipamento: equipamentoOs,
            centro_trabalho: centroTrabalho || null,
            data_necessidade: dataNecessidade || null,
            destino_servico: destinoServico,
            tipo_manutencao: tipoManutencao,
            prioridade: prioridade,
            anexo: anexoUrl,
            status: 'aberta',
            setor_centro: setorCentro
        };
        let { error } = await supabase.from('ordens_servico').insert([payload]);
        if (error && String(error.message || '').toLowerCase().includes('equipamento')) {
            const { equipamento: _e, ...semEq } = payload;
            const retry = await supabase.from('ordens_servico').insert([semEq]);
            error = retry.error;
            if (!error) {
                await Swal.fire({ icon: 'info', title: 'OS registrada', text: 'Atualize o banco com a coluna equipamento em ordens_servico para vincular o equipamento à OS (script SQL na pasta do projeto).' });
            }
        }
        if (error && String(error.message || '').toLowerCase().includes('setor_centro')) {
            const { setor_centro: _sc, ...semSc } = payload;
            const retry2 = await supabase.from('ordens_servico').insert([semSc]);
            error = retry2.error;
            if (!error) {
                await Swal.fire({ icon: 'info', title: 'OS registrada', text: 'Execute supabase_add_setor_centro_avaliacao_os.sql no Supabase para gravar o setor (código MT).' });
            }
        }
        if (error) throw error;
        mostrarSucesso('Solicitação enviada!');
        e.target.reset();
        obterProximoNumeroOS().then(num => { const c = document.getElementById('os-numero'); if (c) c.value = num; });
        navegarParaInicio();
    } catch (err) {
        mostrarErro('Erro', err.message || 'Não foi possível enviar. Execute supabase_setup_ordens_servico.sql');
    }
});

function iniciarRealtimeMinhasSolicitacoes() {
    if (!estado.usuario?.id || estado.realtimeChannelOS) return;
    const channel = supabase
        .channel('minhas-os-updates')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ordens_servico', filter: 'id_solicitante=eq.' + estado.usuario.id }, () => {
            carregarMinhasSolicitacoes();
        })
        .subscribe();
    estado.realtimeChannelOS = channel;
}

function secaoAvaliacaoMinhaOS(os) {
    if (os.status !== 'concluida') return '';
    const a = os.avaliacao_solicitante;
    if (a != null && a >= 1 && a <= 5) {
        return `<div class="minha-os-avaliacao minha-os-avaliacao--lida">
            <span class="minha-os-avaliacao-titulo">Sua avaliação</span>
            <span class="os-stars-read" aria-hidden="true">${'★'.repeat(a)}${'☆'.repeat(5 - a)}</span>
            <span class="os-stars-read-num">(${a}/5)</span>
        </div>`;
    }
    const idEsc = String(os.id || '').replace(/"/g, '');
    const botoes = [1, 2, 3, 4, 5]
        .map(
            (n) =>
                `<button type="button" class="os-star-btn os-star-btn--salvar" data-os-id="${idEsc}" data-estrela="${n}" aria-label="${n} de 5 estrelas">★</button>`
        )
        .join('');
    return `<div class="minha-os-avaliacao" data-os-id="${idEsc}">
            <span class="minha-os-avaliacao-titulo">Avalie o atendimento da manutenção</span>
            <div class="os-stars os-stars--input" role="radiogroup" aria-label="Avaliar de 1 a 5 estrelas">${botoes}</div>
            <div class="os-stars-legend-row"><span>Pouco satisfeito</span><span>Muito satisfeito</span></div>
        </div>`;
}

function escaparHtmlBasico(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tituloSolicitacaoPadrao(numeroSolicitacao) {
    const numero = String(numeroSolicitacao || '').trim();
    return numero ? `OS #${numero}` : 'Solicitação de manutenção';
}

function montarProblemaOS(titulo, descricao) {
    const desc = String(descricao || '').trim();
    if (desc) return desc;
    return String(titulo || '').trim();
}

function optionsHtmlSelect(valores, selecionado) {
    const atual = String(selecionado || '').trim();
    return (valores || [])
        .map((item) => {
            const v = String(item || '').trim();
            const sel = v === atual ? ' selected' : '';
            return `<option value="${escaparHtmlBasico(v)}"${sel}>${escaparHtmlBasico(v)}</option>`;
        })
        .join('');
}

async function carregarMinhasSolicitacoes() {
    const lista = document.getElementById('lista-minhas-solicitacoes');
    if (!lista) return;
    lista.innerHTML = '<div class="centro" style="padding:2rem;">Carregando...</div>';
    const { data, error } = await supabase.from('ordens_servico').select('*').eq('id_solicitante', estado.usuario.id).order('criado_em', { ascending: false });
    if (error) {
        lista.innerHTML = '<div class="card centro" style="padding:2rem;color:#991b1b;">' + (error.message.includes('does not exist') ? 'Execute supabase_setup_ordens_servico.sql' : error.message) + '</div>';
        return;
    }
    lista.innerHTML = '';
    if (!data || data.length === 0) {
        lista.innerHTML = '<div class="card centro" style="padding:3rem 1rem;"><p style="color:#666;">Nenhuma solicitação.</p></div>';
        lucide.createIcons();
        return;
    }

    let mapNormColabs = new Map();
    try {
        const { data: todasProg } = await supabase.from('programacoes').select('os_numero, id_colaborador').limit(2000);
        for (const p of todasProg || []) {
            const k = normalizarChaveNumeroOs(p.os_numero);
            if (!mapNormColabs.has(k)) mapNormColabs.set(k, new Set());
            mapNormColabs.get(k).add(p.id_colaborador);
        }
    } catch (_) {
        mapNormColabs = new Map();
    }

    const idsNomes = new Set();
    for (const os of data) {
        if (os.id_responsavel) idsNomes.add(os.id_responsavel);
        const kn = normalizarChaveNumeroOs(numeroOsParaProgramacao(os, os.id));
        const setC = mapNormColabs.get(kn);
        if (setC) setC.forEach((id) => idsNomes.add(id));
    }
    let nomePorId = new Map();
    if (idsNomes.size > 0) {
        const { data: perfRows } = await supabase.from('perfis').select('id, nome_completo').in('id', [...idsNomes]);
        nomePorId = new Map((perfRows || []).map((r) => [r.id, String(r.nome_completo || '').trim() || '—']));
    }

    const statusLabel = { aberta: 'Aberta', programada: 'Programada', em_andamento: 'Em Andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
    const statusClass = { aberta: 'badge-wait', programada: 'badge-programada', em_andamento: 'badge-andamento', concluida: 'badge-concluida', cancelada: 'badge-cancelada' };
    data.forEach(os => {
        const card = document.createElement('div');
        card.className = 'card card-minha-os';
        const dataAbertura = os.criado_em ? new Date(os.criado_em).toLocaleDateString('pt-BR') : '—';
        const numero = os.numero_solicitacao || os.id?.slice(0, 8) || '—';
        const descEscapada = (os.descricao || '—').replace(/</g, '&lt;').replace(/\n/g, '<br>');
        const linhaUnidade = (os.setor || os.unidade || '—').replace(/</g, '&lt;');
        const linhaCentro = os.setor_centro ? String(os.setor_centro).replace(/</g, '&lt;') : '';
        const nomEq = os.equipamento ? String(os.equipamento).replace(/</g, '&lt;') : '';
        const metaBits = [linhaUnidade];
        if (linhaCentro) metaBits.push(linhaCentro);
        if (nomEq) metaBits.push(nomEq);
        metaBits.push(dataAbertura);

        const knOs = normalizarChaveNumeroOs(numeroOsParaProgramacao(os, os.id));
        const colabsProg = [...(mapNormColabs.get(knOs) || [])];
        const ordemIds = [];
        if (os.id_responsavel) ordemIds.push(os.id_responsavel);
        for (const cid of colabsProg) {
            if (!ordemIds.includes(cid)) ordemIds.push(cid);
        }
        let blocoDesignados = '';
        if (ordemIds.length > 0) {
            const nomes = ordemIds.map((id) => escaparHtmlBasico(nomePorId.get(id) || id.slice(0, 8))).join(', ');
            blocoDesignados = `<div class="minha-os-designados"><span class="minha-os-designados-titulo">Designado(s):</span> ${nomes}</div>`;
        } else if (os.status === 'aberta') {
            blocoDesignados = '<div class="minha-os-designados minha-os-designados--aguarde">Aguardando designação pela manutenção</div>';
        }

        card.innerHTML = `
            <div class="minha-os-header">
                <span class="minha-os-numero">#${String(numero).replace(/</g, '&lt;')}</span>
                <span class="badge ${statusClass[os.status] || 'badge-wait'}">${statusLabel[os.status] || os.status}</span>
            </div>
            <div class="minha-os-descricao">${descEscapada}</div>
            ${blocoDesignados}
            <div class="minha-os-meta">${metaBits.join(' · ')}</div>
            ${(os.status === 'aberta' || os.status === 'programada')
                ? `<div class="minha-os-acoes" style="margin-top:0.8rem;">
                    <button type="button" class="btn btn-outline btn-editar-minha-os" data-os-id="${String(os.id || '').replace(/"/g, '')}" style="width:auto;min-height:36px;padding:0 0.9rem;">
                        Editar solicitação
                    </button>
                </div>`
                : ''}
            ${secaoAvaliacaoMinhaOS(os)}
        `;
        lista.appendChild(card);
    });
    lucide.createIcons();
}

document.getElementById('lista-minhas-solicitacoes')?.addEventListener('click', async (e) => {
    const btnEditar = e.target.closest('.btn-editar-minha-os');
    if (btnEditar && estado.usuario?.id) {
        e.preventDefault();
        const osId = btnEditar.dataset.osId;
        if (!osId) return;
        try {
            const { data: osAtual, error: erroBusca } = await supabase
                .from('ordens_servico')
                .select('id, numero_solicitacao, titulo, descricao, status, setor, unidade, setor_centro, equipamento, centro_trabalho, data_necessidade, destino_servico, tipo_manutencao, prioridade')
                .eq('id', osId)
                .eq('id_solicitante', estado.usuario.id)
                .single();
            if (erroBusca || !osAtual) throw new Error('Solicitação não encontrada.');
            if (osAtual.status !== 'aberta' && osAtual.status !== 'programada') {
                mostrarErro('Edição não permitida', 'Só é possível editar solicitações abertas ou programadas.');
                return;
            }

            const unidadeAtual = String(osAtual.setor || osAtual.unidade || '').trim();
            const unidadeOpc = [...UNIDADES_OPERACAO];
            const unidadeInicial = unidadeOpc.includes(unidadeAtual) ? unidadeAtual : (unidadeOpc[0] || '');
            const listaEquipInicial = obterListaEquipamentosParaUnidade(unidadeInicial);
            const equipAtual = String(osAtual.equipamento || '').trim();
            const equipInicial = listaEquipInicial.includes(equipAtual) ? equipAtual : '';
            const centroAtual = String(osAtual.centro_trabalho || '').trim();
            const destinoAtual = String(osAtual.destino_servico || '').trim();
            const tipoAtual = String(osAtual.tipo_manutencao || '').trim();
            const prioridadeAtual = String(osAtual.prioridade || '').trim();
            const setorCentroAtual = String(osAtual.setor_centro || '').trim();
            const dataNecAtual = osAtual.data_necessidade ? String(osAtual.data_necessidade).slice(0, 10) : '';

            const { value: form, isConfirmed } = await Swal.fire({
                title: 'Editar solicitação',
                html: `
                    <div style="text-align:left;display:grid;gap:0.7rem;">
                        <label>Unidade</label>
                        <select id="edit-os-unidade" class="swal2-input" style="margin:0;">${optionsHtmlSelect(unidadeOpc, unidadeInicial)}</select>
                        <label>Setor (código / centro MT)</label>
                        <select id="edit-os-setor-centro" class="swal2-input" style="margin:0;">${optionsHtmlSelect(SETORES, setorCentroAtual)}</select>
                        <label>Equipamento</label>
                        <select id="edit-os-equipamento" class="swal2-input" style="margin:0;">${optionsHtmlSelect(listaEquipInicial, equipInicial)}</select>
                        <label>Centro de trabalho</label>
                        <select id="edit-os-centro" class="swal2-input" style="margin:0;">${optionsHtmlSelect(['Elétrica', 'Mecânica'], centroAtual)}</select>
                        <label>Data de necessidade</label>
                        <input id="edit-os-data-necessidade" type="date" class="swal2-input" value="${escaparHtmlBasico(dataNecAtual)}" style="margin:0;">
                        <label>Destino do serviço</label>
                        <select id="edit-os-destino" class="swal2-input" style="margin:0;">${optionsHtmlSelect(['Manutenção', 'Frota', 'Operação', 'Projeto', 'Segurança', 'Automação'], destinoAtual)}</select>
                        <label>Tipo de manutenção</label>
                        <select id="edit-os-tipo" class="swal2-input" style="margin:0;">${optionsHtmlSelect(['Corretiva', 'Império', 'Melhoria'], tipoAtual)}</select>
                        <label>Prioridade</label>
                        <select id="edit-os-prioridade" class="swal2-input" style="margin:0;">${optionsHtmlSelect(['Urgente', 'Alta', 'Média', 'Baixa'], prioridadeAtual)}</select>
                        <label>Descrição do serviço</label>
                        <textarea id="edit-os-descricao" class="swal2-textarea" maxlength="3000" style="margin:0;min-height:120px;">${escaparHtmlBasico(String(osAtual.descricao || ''))}</textarea>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: 'Salvar',
                cancelButtonText: 'Cancelar',
                didOpen: () => {
                    const selUn = document.getElementById('edit-os-unidade');
                    const selEq = document.getElementById('edit-os-equipamento');
                    const atualizarEquip = () => {
                        const unidade = selUn?.value || '';
                        const listaEq = obterListaEquipamentosParaUnidade(unidade);
                        if (!selEq) return;
                        const atual = selEq.value;
                        selEq.innerHTML = optionsHtmlSelect(listaEq, atual);
                        if (!selEq.value && listaEq.length > 0) selEq.value = listaEq[0];
                    };
                    selUn?.addEventListener('change', atualizarEquip);
                },
                preConfirm: () => {
                    const unidade = document.getElementById('edit-os-unidade')?.value?.trim() || '';
                    const setorCentro = document.getElementById('edit-os-setor-centro')?.value?.trim() || '';
                    const equipamento = document.getElementById('edit-os-equipamento')?.value?.trim() || '';
                    const centroTrabalho = document.getElementById('edit-os-centro')?.value?.trim() || '';
                    const dataNecessidade = document.getElementById('edit-os-data-necessidade')?.value || null;
                    const destinoServico = document.getElementById('edit-os-destino')?.value?.trim() || '';
                    const tipoManutencao = document.getElementById('edit-os-tipo')?.value?.trim() || '';
                    const prioridade = document.getElementById('edit-os-prioridade')?.value?.trim() || '';
                    const descricao = document.getElementById('edit-os-descricao')?.value?.trim() || '';
                    if (!unidade) {
                        Swal.showValidationMessage('Selecione a unidade.');
                        return false;
                    }
                    if (!setorCentro) {
                        Swal.showValidationMessage('Selecione o setor (código / centro MT).');
                        return false;
                    }
                    if (!equipamento) {
                        Swal.showValidationMessage('Selecione o equipamento.');
                        return false;
                    }
                    if (!descricao) {
                        Swal.showValidationMessage('A descrição não pode ficar vazia.');
                        return false;
                    }
                    return { unidade, setorCentro, equipamento, centroTrabalho, dataNecessidade, destinoServico, tipoManutencao, prioridade, descricao };
                }
            });
            if (!isConfirmed) return;
            const descricaoFinal = String(form.descricao || '').trim();
            const { error: erroUpdate } = await supabase
                .from('ordens_servico')
                .update({
                    descricao: descricaoFinal,
                    titulo: tituloSolicitacaoPadrao(osAtual.numero_solicitacao),
                    setor: form.unidade,
                    unidade: form.unidade,
                    setor_centro: form.setorCentro,
                    equipamento: form.equipamento,
                    centro_trabalho: form.centroTrabalho || null,
                    data_necessidade: form.dataNecessidade || null,
                    destino_servico: form.destinoServico || null,
                    tipo_manutencao: form.tipoManutencao || null,
                    prioridade: form.prioridade || null,
                    atualizado_em: new Date().toISOString()
                })
                .eq('id', osId)
                .eq('id_solicitante', estado.usuario.id);
            if (erroUpdate) throw erroUpdate;
            mostrarSucesso('Solicitação atualizada!');
            carregarMinhasSolicitacoes();
            if (estado.perfil?.funcao === 'admin') {
                carregarOrdensPendentes();
                carregarGestaoOS();
            }
        } catch (err) {
            mostrarErro('Erro', err.message || 'Não foi possível atualizar a solicitação.');
        }
        return;
    }

    const btn = e.target.closest('.os-star-btn--salvar');
    if (!btn || !estado.usuario?.id) return;
    e.preventDefault();
    const osId = btn.dataset.osId;
    const est = parseInt(btn.dataset.estrela, 10);
    if (!osId || est < 1 || est > 5) return;
    try {
        const { error } = await supabase
            .from('ordens_servico')
            .update({
                avaliacao_solicitante: est,
                avaliacao_solicitante_em: new Date().toISOString()
            })
            .eq('id', osId)
            .eq('id_solicitante', estado.usuario.id);
        if (error) throw error;
        Toast.fire({ icon: 'success', title: 'Obrigado pela avaliação!' });
        carregarMinhasSolicitacoes();
    } catch (err) {
        const msg = String(err.message || err || '');
        if (msg.toLowerCase().includes('column')) {
            mostrarErro('Banco de dados', 'Execute o script supabase_add_setor_centro_avaliacao_os.sql no Supabase.');
        } else {
            mostrarErro('Erro', msg || 'Não foi possível salvar a avaliação.');
        }
    }
});

async function carregarOrdensPendentes() {
    if (estado.perfil?.funcao !== 'admin') return;
    const lista = document.getElementById('lista-ordens-pendentes');
    const filtroSetorUnidade = document.getElementById('filtro-os-setor-unidade')?.value || '';
    if (!lista) return;
    lista.innerHTML = '<div class="centro" style="padding:1.5rem;">Carregando...</div>';

    let query = supabase.from('ordens_servico').select('*').order('criado_em', { ascending: false });
    if (filtroSetorUnidade) query = query.eq('setor', filtroSetorUnidade);
    const { data: ordens, error } = await query;

    if (error) {
        lista.innerHTML = '<div class="centro" style="padding:1rem;color:#991b1b;">' + (error.message.includes('does not exist') ? 'Execute supabase_setup_ordens_servico.sql' : error.message) + '</div>';
        return;
    }

    const pendentes = (ordens || []).filter(o => o.status === 'aberta');
    if (pendentes.length === 0) {
        lista.innerHTML = '<p style="color:#666;padding:1rem;">Nenhuma OS aberta no momento.</p>';
        lucide.createIcons();
        return;
    }

    await carregarUsuarios();
    const responsavelSelect = document.getElementById('admin-responsavel-os');
    if (responsavelSelect) {
        responsavelSelect.innerHTML = '<option value="">Selecione o responsável...</option>';
        (estado.usuarios || []).filter(u => u.funcao !== 'admin' && (u.tipo_perfil === 'manutencao' || !u.tipo_perfil)).forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = u.nome_completo || u.id;
            responsavelSelect.appendChild(opt);
        });
    }

    lista.innerHTML = '';
    pendentes.forEach(os => {
        const div = document.createElement('div');
        div.className = 'item-lista';
        div.style.display = 'flex';
        div.style.alignItems = 'flex-start';
        div.style.gap = '12px';
        const dataAbertura = os.criado_em ? new Date(os.criado_em).toLocaleDateString('pt-BR') : '—';
        const numeroExibicao = os.numero_solicitacao || os.id?.slice(0, 8) || '—';
        const tituloExibicao = tituloSolicitacaoPadrao(numeroExibicao);
        div.innerHTML = `
            <input type="checkbox" class="os-pendente-cb" data-id="${os.id}" style="margin-top:6px;">
            <div style="flex:1;">
                <strong>${tituloExibicao.replace(/</g, '&lt;')}</strong>
                <p style="font-size:0.85rem;color:#666;margin:4px 0 0;">${(os.descricao || '').replace(/</g, '&lt;').substring(0, 80)}...</p>
                <p style="font-size:0.8rem;color:#888;margin-top:4px;">${os.setor || os.unidade}${os.setor_centro ? ' · ' + String(os.setor_centro).replace(/</g, '&lt;') : ''} • ${dataAbertura}</p>
            </div>
        `;
        lista.appendChild(div);
    });
    lucide.createIcons();
}

function preencherFiltrosOrdensPendentes() {
    const sel = document.getElementById('filtro-os-setor-unidade');
    if (sel && sel.options.length <= 1) {
        sel.innerHTML = '<option value="">Todos</option>';
        UNIDADES_OPERACAO.forEach(u => { const o = document.createElement('option'); o.value = u; o.textContent = u; sel.appendChild(o); });
    }
}

document.getElementById('btn-encaminhar-os')?.addEventListener('click', async () => {
    const responsavel = document.getElementById('admin-responsavel-os')?.value;
    if (!responsavel) { mostrarErro('Selecione o responsável', 'Escolha um mecânico ou eletricista.'); return; }
    const ids = [...document.querySelectorAll('.os-pendente-cb:checked')].map(cb => cb.dataset.id);
    if (ids.length === 0) { mostrarErro('Selecione ao menos uma OS', 'Marque as ordens que deseja encaminhar.'); return; }
    try {
        for (const id of ids) {
            const { data: os } = await supabase.from('ordens_servico').select('titulo, descricao, setor, unidade, setor_centro').eq('id', id).single();
            await supabase.from('ordens_servico').update({ status: 'programada', id_responsavel: responsavel, atualizado_em: new Date().toISOString() }).eq('id', id);
            if (os) {
                const numeroOs = id.slice(0, 8).replace(/-/g, '');
                const sufixoCentro = os.setor_centro ? ` · ${os.setor_centro}` : '';
                await supabase.from('programacoes').insert([{
                    id_colaborador: responsavel,
                    os_numero: numeroOs,
                    setor_unidade: `${os.unidade} - ${os.setor}${sufixoCentro}`,
                    problema: montarProblemaOS(os.titulo, os.descricao),
                    data_programada: new Date().toISOString().slice(0, 10)
                }]);
            }
        }
        mostrarSucesso('OS encaminhada(s)!');
        carregarOrdensPendentes();
    } catch (err) {
        mostrarErro('Erro', err.message || 'Não foi possível encaminhar.');
    }
});

document.getElementById('filtro-os-setor-unidade')?.addEventListener('change', () => carregarOrdensPendentes());

const STATUS_OS_OPCOES = [
    { value: 'planejada', label: 'Planejada', cor: '#7c3aed' },
    { value: 'programada', label: 'Programada', cor: '#eab308' },
    { value: 'em_andamento', label: 'Em Andamento', cor: '#2563eb' },
    { value: 'concluida', label: 'Concluída', cor: '#16a34a' },
    { value: 'encerrada', label: 'Encerrada', cor: '#0f766e' },
    { value: 'cancelada', label: 'Cancelada', cor: '#dc2626' }
];
const STATUS_OS_COR = { aberta: '#94a3b8', planejada: '#7c3aed', programada: '#eab308', em_andamento: '#2563eb', concluida: '#16a34a', encerrada: '#0f766e', cancelada: '#dc2626' };
const STATUS_OS_LABEL = { aberta: 'Aberta', planejada: 'Planejada', programada: 'Programada', em_andamento: 'Em Andamento', concluida: 'Concluída', encerrada: 'Encerrada', cancelada: 'Cancelada' };
const STATUS_OS_BADGE_CLASS = { aberta: 'badge-wait', planejada: 'badge-programada', programada: 'badge-programada', em_andamento: 'badge-andamento', concluida: 'badge-concluida', encerrada: 'badge-ok', cancelada: 'badge-cancelada' };

const CALENDARIO_STATUS = {
    ferias: { label: 'Férias', classe: 'cal-status-ferias' },
    banco_horas: { label: 'Banco de horas', classe: 'cal-status-banco_horas' },
    atividade_programada: { label: 'Atividade programada', classe: 'cal-status-atividade_programada' },
    sem_atividade: { label: 'Sem atividade', classe: 'cal-status-sem_atividade' },
    atividade_externa: { label: 'Atividade externa', classe: 'cal-status-atividade_externa' }
};

function preencherFiltrosGestaoOS() {
    const sel = document.getElementById('gestao-filtro-setor');
    if (sel && sel.options.length <= 1) {
        sel.innerHTML = '<option value="">Todos</option>';
        UNIDADES_OPERACAO.forEach(u => { const o = document.createElement('option'); o.value = u; o.textContent = u; sel.appendChild(o); });
    }
}

async function carregarGestaoOS() {
    if (estado.perfil?.funcao !== 'admin') return;
    const lista = document.getElementById('lista-gestao-os');
    if (!lista) return;
    lista.innerHTML = '<div class="centro" style="padding:2rem;">Carregando...</div>';

    let query = supabase.from('ordens_servico').select('*').order('criado_em', { ascending: false });
    const num = document.getElementById('gestao-filtro-numero')?.value?.trim();
    if (num) query = query.ilike('numero_solicitacao', '%' + num + '%');
    const setor = document.getElementById('gestao-filtro-setor')?.value;
    if (setor) query = query.eq('setor', setor);
    const centro = document.getElementById('gestao-filtro-centro')?.value;
    if (centro) query = query.eq('centro_trabalho', centro);
    const prioridade = document.getElementById('gestao-filtro-prioridade')?.value;
    if (prioridade) query = query.eq('prioridade', prioridade);
    const statusSelecionado = document.getElementById('gestao-filtro-status')?.value || '';
    if (statusSelecionado) query = query.eq('status', statusSelecionado);
    const dataInicio = document.getElementById('gestao-filtro-data-inicio')?.value;
    if (dataInicio) query = query.gte('criado_em', dataInicio + 'T00:00:00');
    const dataFim = document.getElementById('gestao-filtro-data-fim')?.value;
    if (dataFim) query = query.lte('criado_em', dataFim + 'T23:59:59');

    const { data: ordens, error } = await query;

    if (error) {
        lista.innerHTML = '<div class="card centro" style="padding:2rem;color:#991b1b;">' + (error.message || 'Erro ao carregar.') + '</div>';
        lucide.createIcons();
        return;
    }
    if (!ordens || ordens.length === 0) {
        lista.innerHTML = '<div class="card centro" style="padding:3rem 1rem;"><p style="color:#666;">Nenhuma ordem de serviço encontrada.</p></div>';
        lucide.createIcons();
        return;
    }

    const idsSolicitantes = [...new Set(ordens.map(o => o.id_solicitante).filter(Boolean))];
    let nomePorSolicitante = {};
    if (idsSolicitantes.length > 0) {
        const { data: perfis } = await supabase.from('perfis').select('id, nome_completo').in('id', idsSolicitantes);
        (perfis || []).forEach(p => { nomePorSolicitante[p.id] = p.nome_completo || '—'; });
    }

    lista.innerHTML = '';
    ordens.forEach(os => {
        const card = document.createElement('div');
        card.className = 'card card-gestao-os';
        const statusAtual = os.status || 'aberta';
        const corBorda = STATUS_OS_COR[statusAtual] || '#94a3b8';
        const badgeClass = STATUS_OS_BADGE_CLASS[statusAtual] || 'badge-wait';
        const labelStatus = STATUS_OS_LABEL[statusAtual] || statusAtual;
        const nomeSolicitante = nomePorSolicitante[os.id_solicitante] || '—';
        card.style.cssText = `padding: 1.25rem; margin-bottom: 1rem; border-left: 4px solid ${corBorda};`;
        const dataAbertura = os.criado_em ? new Date(os.criado_em).toLocaleDateString('pt-BR') : '—';
        const numero = os.numero_solicitacao || os.id?.slice(0, 8) || '—';
        const opts = STATUS_OS_OPCOES.map(s => `<option value="${s.value}" ${s.value === statusAtual ? 'selected' : ''}>${s.label}</option>`).join('');
        const descEscapada = (os.descricao || '—').replace(/</g, '&lt;').replace(/\n/g, '<br>');
        card.innerHTML = `
            <div class="gestao-os-topo">
                <div class="gestao-os-info">
                    <span class="gestao-os-numero">#${String(numero).replace(/</g, '&lt;')}</span>
                    <span class="gestao-os-solicitante">Solicitante: ${String(nomeSolicitante).replace(/</g, '&lt;')}</span>
                    <span class="gestao-os-meta">${(os.setor || os.unidade || '—').replace(/</g, '&lt;')}${os.setor_centro ? ' · ' + String(os.setor_centro).replace(/</g, '&lt;') : ''}${os.equipamento ? ' · Eq.: ' + String(os.equipamento).replace(/</g, '&lt;') : ''} · ${os.centro_trabalho || '—'} · ${dataAbertura}</span>
                </div>
                <div class="gestao-os-status-wrap">
                    <span class="badge ${badgeClass}">${labelStatus}</span>
                    <select class="gestao-os-status select-campo" data-id="${os.id}">
                        <option value="aberta" ${statusAtual === 'aberta' ? 'selected' : ''}>Aberta</option>
                        ${opts}
                    </select>
                </div>
            </div>
            <div class="gestao-os-descricao">${descEscapada}</div>
            <div class="gestao-os-rodape">${os.prioridade || '—'} · ${os.destino_servico || '—'} · ${os.tipo_manutencao || '—'}</div>
            ${os.status === 'concluida'
                ? (os.avaliacao_solicitante != null && os.avaliacao_solicitante >= 1 && os.avaliacao_solicitante <= 5
                    ? `<div class="gestao-os-avaliacao"><strong>Avaliação do solicitante:</strong> <span class="gestao-os-avaliacao-stars" aria-hidden="true">${'★'.repeat(
                        os.avaliacao_solicitante
                    )}${'☆'.repeat(5 - os.avaliacao_solicitante)}</span> <span class="gestao-os-avaliacao-num">(${os.avaliacao_solicitante}/5)</span></div>`
                    : '<div class="gestao-os-avaliacao gestao-os-avaliacao--pendente"><strong>Avaliação do solicitante:</strong> <em>ainda não registrada</em></div>')
                : ''}
        `;
        lista.appendChild(card);
    });

    lista.querySelectorAll('.gestao-os-status').forEach(sel => {
        sel.addEventListener('change', async (e) => {
            const id = e.target.dataset.id;
            const status = e.target.value;
            try {
                const { error } = await supabase.from('ordens_servico').update({ status, atualizado_em: new Date().toISOString() }).eq('id', id);
                if (error) throw error;
                Toast.fire({ icon: 'success', title: 'Status atualizado! O perfil Operação verá a alteração.' });
                carregarGestaoOS();
            } catch (err) {
                mostrarErro('Erro', err.message || 'Não foi possível atualizar.');
            }
        });
    });
    lucide.createIcons();
}

document.getElementById('gestao-btn-filtrar')?.addEventListener('click', () => carregarGestaoOS());
document.getElementById('gestao-btn-limpar')?.addEventListener('click', () => {
    document.getElementById('gestao-filtro-numero').value = '';
    document.getElementById('gestao-filtro-setor').value = '';
    document.getElementById('gestao-filtro-centro').value = '';
    document.getElementById('gestao-filtro-prioridade').value = '';
    const statusSel = document.getElementById('gestao-filtro-status');
    if (statusSel) statusSel.value = '';
    document.getElementById('gestao-filtro-data-inicio').value = '';
    document.getElementById('gestao-filtro-data-fim').value = '';
    carregarGestaoOS();
});

function intervaloMes(dataRef) {
    const dt = new Date(dataRef.getFullYear(), dataRef.getMonth(), 1);
    const inicio = new Date(dt.getFullYear(), dt.getMonth(), 1);
    const fim = new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
    return {
        inicio: inicio.toISOString().slice(0, 10),
        fim: fim.toISOString().slice(0, 10),
        label: dt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    };
}

function montarLegendaCalendario(el) {
    if (!el) return;
    el.innerHTML = Object.entries(CALENDARIO_STATUS).map(([key, cfg]) => `
        <span class="cal-legenda-item">
            <span class="cal-legenda-cor ${cfg.classe}" aria-hidden="true"></span>${cfg.label}
        </span>
    `).join('');
}

function statusCalendarioInfo(status) {
    return CALENDARIO_STATUS[status] || CALENDARIO_STATUS.sem_atividade;
}

async function renderGridCalendarioAdmin() {
    const titulo = document.getElementById('cal-admin-titulo');
    const grid = document.getElementById('cal-admin-grid');
    const legenda = document.getElementById('cal-admin-legenda');
    const colabSel = document.getElementById('cal-admin-colaborador');
    const colab = colabSel?.value || '';
    const mesAno = document.getElementById('cal-admin-mesano')?.value || '';
    if (!grid) return;

    montarLegendaCalendario(legenda);

    if (!colab || !mesAno) {
        if (titulo) titulo.textContent = 'Calendário do colaborador';
        grid.innerHTML = '<div class="centro" style="grid-column:1/-1;padding:1rem;color:#64748b;">Selecione colaborador e mês para visualizar o calendário.</div>';
        return;
    }

    const [ano, mes] = mesAno.split('-').map(Number);
    const ref = new Date(ano, (mes || 1) - 1, 1);
    const intervalo = intervaloMes(ref);
    const nomeColab = colabSel?.selectedOptions?.[0]?.textContent?.trim() || '—';
    if (titulo) titulo.textContent = `${nomeColab} — ${intervalo.label}`;

    grid.innerHTML = '<div class="centro" style="grid-column:1/-1;padding:1rem;">Carregando...</div>';

    const { data, error } = await supabase
        .from('calendario_colaboradores')
        .select('data_referencia, status, observacao')
        .eq('id_colaborador', colab)
        .gte('data_referencia', intervalo.inicio)
        .lte('data_referencia', intervalo.fim);

    if (error && !String(error.message || '').includes('does not exist')) {
        grid.innerHTML = `<div class="card centro" style="grid-column:1/-1;color:#991b1b;">${error.message}</div>`;
        return;
    }

    const mapa = new Map((data || []).map((d) => {
        const obs = d.observacao ? String(d.observacao) : '';
        return [String(d.data_referencia), { status: String(d.status || 'sem_atividade'), obs }];
    }));

    const ini = new Date(intervalo.inicio + 'T12:00:00');
    const fim = new Date(intervalo.fim + 'T12:00:00');
    const offset = (ini.getDay() + 6) % 7;

    const cab = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    grid.innerHTML = cab.map((d) => `<div class="cal-dia-semana">${d}</div>`).join('');
    for (let i = 0; i < offset; i++) grid.innerHTML += '<div class="cal-dia cal-dia-vazio"></div>';
    for (let dia = 1; dia <= fim.getDate(); dia++) {
        const chave = `${intervalo.inicio.slice(0, 8)}${String(dia).padStart(2, '0')}`;
        const item = mapa.get(chave) || { status: 'sem_atividade', obs: '' };
        const info = statusCalendarioInfo(item.status);
        const tooltip = [info.label, item.obs].filter(Boolean).join(' — ').replace(/</g, '&lt;');
        grid.innerHTML += `<div class="cal-dia" title="${tooltip}"><span class="cal-dia-num">${dia}</span><span class="cal-dia-status cal-dia-status--compact-mobile ${info.classe}">${info.label}</span></div>`;
    }
    lucide.createIcons();
}

async function renderCalendarioAdminViews() {
    await Promise.all([
        renderListaCalendarioAdmin(),
        renderGridCalendarioAdmin()
    ]);
}

async function carregarCalendarioColaborador() {
    const titulo = document.getElementById('cal-colab-titulo');
    const grid = document.getElementById('cal-colab-grid');
    const legenda = document.getElementById('cal-colab-legenda');
    if (!grid || !estado.usuario?.id) return;
    montarLegendaCalendario(legenda);
    const mes = intervaloMes(calendarioColabMesRef);
    if (titulo) titulo.textContent = mes.label;
    grid.innerHTML = '<div class="centro" style="grid-column:1/-1;padding:1rem;">Carregando...</div>';

    const { data, error } = await supabase
        .from('calendario_colaboradores')
        .select('data_referencia, status')
        .eq('id_colaborador', estado.usuario.id)
        .gte('data_referencia', mes.inicio)
        .lte('data_referencia', mes.fim);

    if (error && !String(error.message || '').includes('does not exist')) {
        grid.innerHTML = `<div class="card centro" style="grid-column:1/-1;color:#991b1b;">${error.message}</div>`;
        return;
    }

    const mapa = new Map((data || []).map((d) => [String(d.data_referencia), String(d.status || 'sem_atividade')]));
    const ini = new Date(mes.inicio + 'T12:00:00');
    const fim = new Date(mes.fim + 'T12:00:00');
    const offset = (ini.getDay() + 6) % 7;

    const cab = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    grid.innerHTML = cab.map((d) => `<div class="cal-dia-semana">${d}</div>`).join('');
    for (let i = 0; i < offset; i++) grid.innerHTML += '<div class="cal-dia cal-dia-vazio"></div>';
    for (let d = 1; d <= fim.getDate(); d++) {
        const chave = `${mes.inicio.slice(0, 8)}${String(d).padStart(2, '0')}`;
        const status = mapa.get(chave) || 'sem_atividade';
        const info = statusCalendarioInfo(status);
        grid.innerHTML += `<div class="cal-dia"><span class="cal-dia-num">${d}</span><span class="cal-dia-status cal-dia-status--compact-mobile ${info.classe}" title="${info.label}">${info.label}</span></div>`;
    }
    lucide.createIcons();
}

async function carregarColaboradoresCalendarioAdmin() {
    const sel = document.getElementById('cal-admin-colaborador');
    if (!sel) return;
    await carregarUsuarios();
    const todos = estado.usuarios || [];
    sel.innerHTML = '<option value="">Selecione...</option>' + todos.map((u) => `<option value="${u.id}">${u.nome_completo || '—'}</option>`).join('');
}

async function renderListaCalendarioAdmin() {
    const lista = document.getElementById('cal-admin-lista');
    const colab = document.getElementById('cal-admin-colaborador')?.value;
    const mesAno = document.getElementById('cal-admin-mesano')?.value;
    if (!lista) return;
    if (!colab || !mesAno) {
        lista.innerHTML = '<p style="color:#64748b;">Selecione colaborador e mês para visualizar.</p>';
        return;
    }
    const [ano, mes] = mesAno.split('-').map(Number);
    const ref = new Date(ano, (mes || 1) - 1, 1);
    const intervalo = intervaloMes(ref);
    const { data, error } = await supabase
        .from('calendario_colaboradores')
        .select('*')
        .eq('id_colaborador', colab)
        .gte('data_referencia', intervalo.inicio)
        .lte('data_referencia', intervalo.fim)
        .order('data_referencia', { ascending: true });
    if (error) {
        lista.innerHTML = `<p style="color:#991b1b;">${error.message?.includes('does not exist') ? 'Execute o script SQL para criar calendario_colaboradores.' : error.message}</p>`;
        return;
    }
    if (!data || data.length === 0) {
        lista.innerHTML = '<p style="color:#64748b;">Nenhuma programação salva no período.</p>';
        return;
    }
    lista.innerHTML = data.map((item) => {
        const info = statusCalendarioInfo(item.status);
        return `<div class="cal-admin-item">
            <div>
                <strong>${new Date(item.data_referencia + 'T12:00:00').toLocaleDateString('pt-BR')}</strong><br>
                <span class="cal-dia-status ${info.classe}">${info.label}</span>
                ${item.observacao ? `<p style="margin:0.4rem 0 0;color:#64748b;font-size:0.82rem;">${String(item.observacao).replace(/</g, '&lt;')}</p>` : ''}
            </div>
            <div style="display:flex;gap:0.4rem;">
                <button type="button" class="btn btn-outline btn-sm cal-admin-editar" data-id="${item.id}" data-data="${item.data_referencia}" data-status="${item.status}" data-observacao="${String(item.observacao || '').replace(/"/g, '&quot;')}"><i data-lucide="pencil"></i></button>
                <button type="button" class="btn btn-outline btn-sm cal-admin-excluir" data-id="${item.id}" style="color:#b91c1c;border-color:#fecaca;"><i data-lucide="trash-2"></i></button>
            </div>
        </div>`;
    }).join('');
    lista.querySelectorAll('.cal-admin-editar').forEach((btn) => {
        btn.addEventListener('click', () => {
            calendarioAdminEditandoId = btn.dataset.id;
            const dataInicio = document.getElementById('cal-admin-data-inicio');
            const dataFim = document.getElementById('cal-admin-data-fim');
            const status = document.getElementById('cal-admin-status');
            const obs = document.getElementById('cal-admin-observacao');
            if (dataInicio) dataInicio.value = btn.dataset.data || '';
            if (dataFim) dataFim.value = btn.dataset.data || '';
            if (status) status.value = btn.dataset.status || '';
            if (obs) obs.value = btn.dataset.observacao || '';
        });
    });
    lista.querySelectorAll('.cal-admin-excluir').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const { error: delErr } = await supabase.from('calendario_colaboradores').delete().eq('id', btn.dataset.id);
            if (delErr) {
                mostrarErro('Erro', delErr.message || 'Não foi possível excluir.');
                return;
            }
            await renderListaCalendarioAdmin();
            mostrarSucesso('Programação removida.');
        });
    });
    lucide.createIcons();
}

async function carregarCalendarioAdmin() {
    if (estado.perfil?.funcao !== 'admin') return;
    await carregarColaboradoresCalendarioAdmin();
    const mesAno = document.getElementById('cal-admin-mesano');
    if (mesAno && !mesAno.value) mesAno.value = new Date().toISOString().slice(0, 7);
    await renderCalendarioAdminViews();
}

document.getElementById('cal-colab-prev')?.addEventListener('click', () => {
    calendarioColabMesRef = new Date(calendarioColabMesRef.getFullYear(), calendarioColabMesRef.getMonth() - 1, 1);
    carregarCalendarioColaborador();
});
document.getElementById('cal-colab-next')?.addEventListener('click', () => {
    calendarioColabMesRef = new Date(calendarioColabMesRef.getFullYear(), calendarioColabMesRef.getMonth() + 1, 1);
    carregarCalendarioColaborador();
});

document.getElementById('cal-admin-colaborador')?.addEventListener('change', renderCalendarioAdminViews);
document.getElementById('cal-admin-mesano')?.addEventListener('change', renderCalendarioAdminViews);
document.getElementById('cal-admin-prev')?.addEventListener('click', () => {
    const mesAno = document.getElementById('cal-admin-mesano');
    if (!mesAno?.value) return;
    const [ano, mes] = mesAno.value.split('-').map(Number);
    const ref = new Date(ano, (mes || 1) - 2, 1);
    mesAno.value = ref.toISOString().slice(0, 7);
    void renderCalendarioAdminViews();
});
document.getElementById('cal-admin-next')?.addEventListener('click', () => {
    const mesAno = document.getElementById('cal-admin-mesano');
    if (!mesAno?.value) return;
    const [ano, mes] = mesAno.value.split('-').map(Number);
    const ref = new Date(ano, (mes || 1), 1);
    mesAno.value = ref.toISOString().slice(0, 7);
    void renderCalendarioAdminViews();
});
document.getElementById('cal-admin-salvar')?.addEventListener('click', async () => {
    if (estado.perfil?.funcao !== 'admin') return;
    const colab = document.getElementById('cal-admin-colaborador')?.value;
    const dataInicio = document.getElementById('cal-admin-data-inicio')?.value;
    const dataFim = document.getElementById('cal-admin-data-fim')?.value || dataInicio;
    const status = document.getElementById('cal-admin-status')?.value;
    const observacao = document.getElementById('cal-admin-observacao')?.value?.trim() || null;
    if (!colab || !dataInicio || !dataFim || !status) {
        mostrarErro('Campos obrigatórios', 'Preencha colaborador, período e status.');
        return;
    }
    if (dataFim < dataInicio) {
        mostrarErro('Período inválido', 'A data final não pode ser menor que a data inicial.');
        return;
    }
    const datas = [];
    let cursor = new Date(dataInicio + 'T12:00:00');
    const fim = new Date(dataFim + 'T12:00:00');
    while (cursor <= fim) {
        datas.push(cursor.toISOString().slice(0, 10));
        cursor.setDate(cursor.getDate() + 1);
    }
    try {
        if (calendarioAdminEditandoId) {
            const { error } = await supabase
                .from('calendario_colaboradores')
                .update({ data_referencia: dataInicio, status, observacao, atualizado_por: estado.usuario.id })
                .eq('id', calendarioAdminEditandoId);
            if (error) throw error;
            calendarioAdminEditandoId = null;
        } else {
            const { data: conflitos } = await supabase
                .from('calendario_colaboradores')
                .select('data_referencia')
                .eq('id_colaborador', colab)
                .in('data_referencia', datas);
            if ((conflitos || []).length > 0) {
                mostrarErro('Conflito de programação', `Já existe programação em ${(conflitos || []).length} dia(s) no período.`);
                return;
            }
            const linhas = datas.map((dataRef) => ({
                id_colaborador: colab,
                data_referencia: dataRef,
                status,
                observacao,
                criado_por: estado.usuario.id
            }));
            const { error } = await supabase.from('calendario_colaboradores').insert(linhas);
            if (error) throw error;
        }
        mostrarSucesso('Programação de calendário salva.');
        await renderListaCalendarioAdmin();
    } catch (e) {
        mostrarErro('Erro', String(e.message || '').includes('does not exist')
            ? 'Tabela de calendário não encontrada. Crie calendario_colaboradores no Supabase.'
            : (e.message || 'Não foi possível salvar.'));
    }
});

function inferirPerfilColaborador(user) {
    const tag = normalizarTextoBusca(user?.tag || '');
    if (tag.includes('eletric')) return 'eletricista';
    if (tag.includes('mecan')) return 'mecanico';
    return 'outros';
}

async function carregarQuemNaoApontou() {
    if (estado.perfil?.funcao !== 'admin') return;
    await carregarUsuarios();
    const filtroData = document.getElementById('qna-filtro-data');
    const filtroColab = document.getElementById('qna-filtro-colaborador');
    if (filtroData && !filtroData.value) filtroData.value = new Date().toISOString().slice(0, 10);
    if (filtroColab && filtroColab.options.length <= 1) {
        filtroColab.innerHTML = '<option value="">Todos</option>' + (estado.usuarios || []).map((u) => `<option value="${u.id}">${u.nome_completo || '—'}</option>`).join('');
    }
    await atualizarTabelaQuemNaoApontou();
}

async function atualizarTabelaQuemNaoApontou() {
    const body = document.getElementById('qna-tabela-body');
    if (!body) return;
    const dataRef = document.getElementById('qna-filtro-data')?.value || new Date().toISOString().slice(0, 10);
    const filtroColab = document.getElementById('qna-filtro-colaborador')?.value || '';
    const filtroPerfil = document.getElementById('qna-filtro-perfil')?.value || '';
    const filtroStatus = document.getElementById('qna-filtro-status')?.value || '';
    const somentePendentes = !!document.getElementById('qna-somente-pendentes')?.checked;
    const colaboradores = (estado.usuarios || []).filter((u) => !filtroColab || u.id === filtroColab);
    const ids = colaboradores.map((c) => c.id);
    if (ids.length === 0) {
        body.innerHTML = '<tr><td colspan="6">Nenhum colaborador encontrado.</td></tr>';
        return;
    }
    const { data: apont } = await supabase
        .from('apontamentos')
        .select('id_manutentor')
        .eq('data_servico', dataRef)
        .in('id_manutentor', ids);
    const apontSet = new Set((apont || []).map((a) => a.id_manutentor));

    const linhas = colaboradores.map((c) => {
        const perfil = inferirPerfilColaborador(c);
        const apontou = apontSet.has(c.id);
        return { c, perfil, apontou };
    }).filter((r) => {
        if (filtroPerfil && r.perfil !== filtroPerfil) return false;
        if (somentePendentes && r.apontou) return false;
        if (filtroStatus === 'apontou' && !r.apontou) return false;
        if (filtroStatus === 'nao_apontou' && r.apontou) return false;
        return true;
    });
    if (linhas.length === 0) {
        body.innerHTML = '<tr><td colspan="5">Nenhum resultado para os filtros.</td></tr>';
        return;
    }
    body.innerHTML = linhas.map(({ c, perfil, apontou }) => `
        <tr>
            <td>${new Date(dataRef + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
            <td>${String(c.nome_completo || '—').replace(/</g, '&lt;')}</td>
            <td>${perfil === 'eletricista' ? 'Eletricista' : perfil === 'mecanico' ? 'Mecânico' : 'Outros'}</td>
            <td>${apontou ? '✓ Apontou' : 'X Não apontou'}</td>
            <td>${apontou ? 'Apontamento registrado no dia' : 'Pendente de apontamento'}</td>
        </tr>
    `).join('');
}

document.getElementById('qna-filtrar')?.addEventListener('click', atualizarTabelaQuemNaoApontou);

async function carregarProgramacoesParaApontamento() {
    const selectOS = document.getElementById('apt-ordem-select');
    const selectUnidade = document.getElementById('apt-unidade');
    if (!selectOS || !selectUnidade) return;

    popularSelectSetoresMT('apt-setor-centro', 'Selecione o setor (código)…');
    const asc0 = document.getElementById('apt-setor-centro');
    if (asc0 && estado.perfil?.setor_centro_padrao && SETORES.includes(estado.perfil.setor_centro_padrao)) {
        asc0.value = estado.perfil.setor_centro_padrao;
    }

    let og = selectUnidade.querySelector('optgroup[label="Setores programados"]');
    if (!og) {
        og = document.createElement('optgroup');
        og.label = 'Setores programados';
        selectUnidade.appendChild(og);
    }
    og.innerHTML = '';

    const { data: progRaw, error } = await supabase
        .from('programacoes')
        .select('*')
        .eq('id_colaborador', estado.usuario?.id)
        .order('data_programada', { ascending: false });

    let prog = progRaw || [];
    if (!error && prog.length > 0) {
        prog = await filtrarProgramacoesOsAindaAbertas(prog);
    }
    estado.programacoesUsuario = prog;
    const unidadesProgramadas = [...new Set((prog || [])
        .map(p => extrairUnidadeDeSetorProgramado(p.setor_unidade))
        .filter(Boolean))];

    selectOS.innerHTML = '<option value="">Selecione uma OS programada...</option>';
    estado.programacoesUsuario.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.os_numero;
        opt.textContent = `OS #${p.os_numero} - ${p.setor_unidade || ''}`;
        opt.dataset.problema = p.problema || '';
        opt.dataset.setor = extrairUnidadeDeSetorProgramado(p.setor_unidade || '');
        selectOS.appendChild(opt);
    });
    const optOutra = document.createElement('option');
    optOutra.value = '__outra__';
    optOutra.textContent = 'OS não programada (nº automático)';
    selectOS.appendChild(optOutra);

    unidadesProgramadas.forEach(unidade => {
        if (!selectUnidade.querySelector(`option[value="${unidade}"]`)) {
            const opt = document.createElement('option');
            opt.value = unidade;
            opt.textContent = unidade;
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
    manualInput.required = false;
    selectOS.required = !isOutra;
    if (!isOutra) {
        manualInput.value = '';
        manualInput.readOnly = false;
    } else {
        manualInput.readOnly = true;
    }
}

function obterOrdemApt() {
    const selectOS = document.getElementById('apt-ordem-select');
    const manualInput = document.getElementById('apt-ordem-manual');
    if (!selectOS || !manualInput) return '';
    if (selectOS.value === '__outra__') return manualInput.value?.trim() || '';
    return selectOS.value || '';
}

document.getElementById('apt-ordem-select')?.addEventListener('change', async function () {
    const val = this.value;
    const manualInput = document.getElementById('apt-ordem-manual');
    const aptDesc = document.getElementById('apt-desc');
    const aptUnidade = document.getElementById('apt-unidade');

    mostrarOcultarAptOrdemManual();

    if (val === '__outra__' || val === '') {
        if (aptDesc) aptDesc.value = '';
        if (aptUnidade) aptUnidade.value = '';
        const asc = document.getElementById('apt-setor-centro');
        if (asc) {
            asc.value = '';
            if (estado.perfil?.setor_centro_padrao && SETORES.includes(estado.perfil.setor_centro_padrao)) {
                asc.value = estado.perfil.setor_centro_padrao;
            }
        }
        await atualizarEquipamentosApontamento('');
        if (val === '__outra__') {
            await preencherNumeroOrdemApontamentoAutomatico();
        }
    } else {
        const opt = this.selectedOptions[0];
        if (opt && aptDesc) aptDesc.value = opt.dataset.problema || '';
        if (opt && aptUnidade) aptUnidade.value = opt.dataset.setor || '';
        await atualizarEquipamentosApontamento(aptUnidade?.value || '');
        await preencherCamposDeOsProgramada(val, opt?.textContent || '');
    }
});

document.getElementById('apt-unidade')?.addEventListener('change', (e) => {
    void atualizarEquipamentosApontamento(e.target.value || '');
});

function setEstadoFinalizadoApontamento(val) {
    const hid = document.getElementById('apt-finalizado');
    const bsim = document.getElementById('btn-apt-final-sim');
    const bnao = document.getElementById('btn-apt-final-nao');
    if (!hid || !bsim || !bnao) return;
    hid.value = val === true ? 'sim' : val === false ? 'nao' : '';
    bsim.classList.toggle('btn-primario', val === true);
    bsim.classList.toggle('btn-secundario', val !== true);
    bnao.classList.toggle('btn-primario', val === false);
    bnao.classList.toggle('btn-outline', val !== false);
    lucide.createIcons();
}

document.getElementById('btn-apt-final-sim')?.addEventListener('click', () => setEstadoFinalizadoApontamento(true));
document.getElementById('btn-apt-final-nao')?.addEventListener('click', () => setEstadoFinalizadoApontamento(false));

async function carregarUsuarios() {
    const select = document.getElementById('apt-manutentor');
    if (!select) return;

    const { data, error } = await supabase
        .from('perfis')
        .select('id, nome_completo, funcao, tipo_perfil')
        .order('nome_completo');

    if (data) {
        const manutentores = data.filter((user) => user.funcao !== 'admin' && (user.tipo_perfil === 'manutencao' || !user.tipo_perfil || user.tipo_perfil === ''));
        estado.usuarios = manutentores;
        select.innerHTML = '<option value="">Selecione o Manutentor...</option>';
        manutentores.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.nome_completo;
            select.appendChild(option);
        });
        if (estado.usuario?.id && manutentores.some(u => u.id === estado.usuario.id)) {
            select.value = estado.usuario.id;
        }
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
    setTimeout(() => atualizarIndicadorLimiteDia(), 120);
}


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
    await atualizarEquipamentosApontamento(apt.unidade);
    definirBloqueioEquipamentoApontamento(true, apt.equipamento || '');
    popularSelectSetoresMT('apt-setor-centro', 'Selecione o setor (código)…');
    const ascEd = document.getElementById('apt-setor-centro');
    if (ascEd && apt.setor_centro) ascEd.value = apt.setor_centro;
    if (temNaProg && selectOS?.value && selectOS.value !== '__outra__') {
        const optProg = selectOS.selectedOptions[0];
        await preencherCamposDeOsProgramada(selectOS.value, optProg?.textContent || '');
        if (ascEd && apt.setor_centro) ascEd.value = apt.setor_centro;
    }
    document.getElementById('apt-centro').value = apt.centro_trabalho;
    document.getElementById('apt-data').value = apt.data_servico;
    document.getElementById('apt-inicio').value = apt.hora_inicio;
    document.getElementById('apt-fim').value = apt.hora_fim;
    setEstadoFinalizadoApontamento(apt.concluido === true ? true : apt.concluido === false ? false : null);
    document.getElementById('apt-obs').value = apt.observacoes || '';

    atualizarVisibilidadeCamposAdmin(apt.conforme_planejado);
    const campoJustificativa = document.getElementById('apt-justificativa');
    if (campoJustificativa) campoJustificativa.value = apt.justificativa || '';

    await carregarUsuarios();
    document.getElementById('apt-manutentor').value = apt.id_manutentor;

    definirCabecalhoApontamentoEdicao();
    const btnSubmit = document.querySelector('#formulario-apontamento button[type="submit"]');
    btnSubmit.innerHTML = '<i data-lucide="save"></i> ATUALIZAR APONTAMENTO';
    btnSubmit.dataset.modo = 'editar';

    window.scrollTo(0, 0);
    setTimeout(() => atualizarIndicadorLimiteDia(), 120);
    lucide.createIcons();
}

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
        const selectOS = document.getElementById('apt-ordem-select');
        let ordem = '';
        if (selectOS?.value === '__outra__') {
            if (isEdicao) {
                ordem = document.getElementById('apt-ordem-manual')?.value?.trim() || '';
            } else {
                ordem = await obterProximoNumeroOrdemUnico();
                const mi = document.getElementById('apt-ordem-manual');
                if (mi) mi.value = ordem;
            }
        } else {
            ordem = selectOS?.value?.trim() || '';
        }
        if (!ordem) {
            throw new Error('Selecione uma OS programada ou a opção «OS não programada (nº automático)».');
        }
        let desc = (document.getElementById('apt-desc').value || '').trim();
        const unidade = document.getElementById('apt-unidade').value;
        let equipamento = isEdicao
            ? (apontamentoEditando?.equipamento || document.getElementById('apt-equipamento')?.value || '')
            : (document.getElementById('apt-equipamento')?.value || '');
        const setorCentroMt = document.getElementById('apt-setor-centro')?.value?.trim() || '';
        const idManutentor = document.getElementById('apt-manutentor').value;
        const centro = document.getElementById('apt-centro').value;
        const dataServico = document.getElementById('apt-data').value;
        const inicio = document.getElementById('apt-inicio').value;
        const fim = document.getElementById('apt-fim').value;
        const finalVal = document.getElementById('apt-finalizado')?.value || '';
        if (finalVal !== 'sim' && finalVal !== 'nao') {
            throw new Error('Indique se o serviço foi finalizado (Sim ou Não).');
        }
        const concluido = finalVal === 'sim';
        const obs = document.getElementById('apt-obs').value;

        const conformeVal = document.getElementById('apt-conforme-planejado')?.value || '';
        const conformePlanejado = conformeVal === 'sim';
        if (conformeVal !== 'sim' && conformeVal !== 'nao') {
            throw new Error('Informe se foi conforme planejado (clique em Sim ou Não).');
        }
        const justificativa = !conformePlanejado ? document.getElementById('apt-justificativa').value?.trim() : null;

        if (!idManutentor) {
            throw new Error('Selecione um manutentor.');
        }
        if (!setorCentroMt) {
            throw new Error('Selecione o setor (código / centro MT).');
        }
        const equipamentoOpcional = !isEdicao && document.getElementById('apt-equipamento')?.dataset?.equipamentoOpcional === '1';
        if (!isEdicao && !equipamentoOpcional && !equipamento) {
            throw new Error('Selecione o equipamento.');
        }
        if (equipamentoOpcional && !equipamento) {
            equipamento = VALOR_SEM_EQUIPAMENTO_APONTAMENTO;
        }

        if (!conformePlanejado && !justificativa) {
            throw new Error('Quando não foi conforme planejado, a justificativa é obrigatória.');
        }

        if (!conformePlanejado && !desc) {
            throw new Error('Informe a descrição da atividade.');
        }
        if (conformePlanejado && !desc) desc = 'Conforme planejado';

        const duracaoNova = duracaoMinutosIntervalo(inicio, fim);
        if (duracaoNova <= 0) {
            throw new Error('O horário de fim deve ser posterior ao início (mesmo dia).');
        }
        const jaApontado = await totalMinutosApontadosNoDia(idManutentor, dataServico, isEdicao ? apontamentoEditando.id : null);
        if (jaApontado + duracaoNova > LIMITE_DIARIO_MINUTOS) {
            throw new Error(
                `Limite diário de ${LIMITE_DIARIO_TEXTO_LEGIVEL} por funcionário nesta data. Já apontado: ${formatarMinutosComoH(jaApontado)}. ` +
                `Este intervalo: ${formatarMinutosComoH(duracaoNova)}. Máximo: ${formatarMinutosComoH(LIMITE_DIARIO_MINUTOS)}.`
            );
        }

        let urlsFotos = apontamentoEditando?.fotos || [];

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
        const suportaEquipamentoApontamento = await verificarSuporteCampoEquipamentoApontamento();
        const suportaSetorCentroApt = await verificarSuporteCampoSetorCentroApontamento();
        const obsFinal = suportaEquipamentoApontamento
            ? obs
            : (obs ? `[Equipamento: ${equipamento}] ${obs}` : `[Equipamento: ${equipamento}]`);

        if (isEdicao) {
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
                observacoes: obsFinal,
                fotos: urlsFotos,
                conforme_planejado: conformePlanejado,
                justificativa: justificativa || null
            };
            if (suportaEquipamentoApontamento) dadosUpdate.equipamento = equipamento;
            if (suportaSetorCentroApt) dadosUpdate.setor_centro = setorCentroMt;

            const { error: updateError } = await supabase
                .from('apontamentos')
                .update(dadosUpdate)
                .eq('id', apontamentoEditando.id);

            if (updateError) throw new Error(updateError.message);
            mostrarSucesso('Apontamento Atualizado!');
        } else {
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
                observacoes: obsFinal,
                fotos: urlsFotos,
                conforme_planejado: conformePlanejado,
                justificativa: justificativa || null
            };
            if (suportaEquipamentoApontamento) dadosInsert.equipamento = equipamento;
            if (suportaSetorCentroApt) dadosInsert.setor_centro = setorCentroMt;

            const { error: insertError } = await supabase.from('apontamentos').insert([dadosInsert]);

            if (insertError) throw new Error(insertError.message);
            mostrarSucesso('Apontamento Salvo!');
        }

        e.target.reset();
        popularSelectSetoresMT('apt-setor-centro', 'Selecione o setor (código)…');
        definirBloqueioEquipamentoApontamento(false);
        setEstadoFinalizadoApontamento(null);
        await atualizarEquipamentosApontamento('');
        apontamentoEditando = null;
        definirCabecalhoApontamentoNovo();
        btn.innerHTML = '<i data-lucide="check-circle"></i> SALVAR APONTAMENTO';
        btn.dataset.modo = '';
        await encerrarOrdemServicoSeConcluido(ordem, concluido);
        await navegarParaInicio();

    } catch (erro) {
        mostrarErro('Ops!', erro.message);
    } finally {
        btn.disabled = false;
        lucide.createIcons();
    }
});


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
        .or(filtroApontamentosPorUsuarioOuManutentor(estado.usuario.id))
        .order('criado_em', { ascending: false });

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

document.getElementById('busca-historico').addEventListener('input', (e) => {
    buscaHistorico = e.target.value.trim();
    carregarHistorico();
});

async function excluirApontamentoConfirmar(log) {
    if (!log?.id || !estado.usuario) return;
    const numSeg = String(log.numero_ordem ?? '').replace(/</g, '');
    const result = await Swal.fire({
        title: 'Excluir apontamento?',
        html: `OS <strong>#${numSeg}</strong> — esta ação não pode ser desfeita.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Excluir'
    });
    if (!result.isConfirmed) return;
    try {
        const { error } = await supabase.from('apontamentos').delete().eq('id', log.id);
        if (error) throw error;
        mostrarSucesso('Apontamento excluído.');
        await carregarHistorico();
        const telaAdmin = document.getElementById('tela-admin');
        if (telaAdmin && !telaAdmin.classList.contains('oculto')) {
            await carregarDadosAdmin();
        }
    } catch (e) {
        mostrarErro('Erro', e.message || 'Não foi possível excluir. Se o erro citar RLS ou permissão, execute supabase_policies_apontamentos_delete.sql no Supabase.');
    }
}

function moinhoIdeiasStorageKey() {
    return 'holambra_moinho_ideias_' + (estado.usuario?.id || '');
}

function fecharFormularioMoinhoIdeias() {
    const wrap = document.getElementById('moinho-formulario-wrap');
    const btn = document.getElementById('btn-moinho-toggle-form');
    if (wrap) wrap.classList.add('oculto');
    if (btn) {
        btn.innerHTML = '<i data-lucide="plus-circle"></i> Nova melhoria';
    }
    lucide.createIcons();
}

function abrirFormularioMoinhoIdeias() {
    const wrap = document.getElementById('moinho-formulario-wrap');
    const btn = document.getElementById('btn-moinho-toggle-form');
    if (wrap) wrap.classList.remove('oculto');
    if (btn) {
        btn.innerHTML = '<i data-lucide="x-circle"></i> Fechar formulário';
    }
    lucide.createIcons();
    wrap?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function alternarFormularioMoinhoIdeias() {
    const wrap = document.getElementById('moinho-formulario-wrap');
    if (!wrap) return;
    if (wrap.classList.contains('oculto')) abrirFormularioMoinhoIdeias();
    else fecharFormularioMoinhoIdeias();
}

async function listarMelhoriasMoinhoIdeias() {
    const { data, error } = await supabase
        .from('melhorias_moinho')
        .select('*')
        .order('criado_em', { ascending: false });

    if (!error && Array.isArray(data)) {
        if (data.length === 0) return [];
        const ids = [...new Set(data.map((r) => r.id_usuario).filter(Boolean))];
        const nomeMap = {};
        if (ids.length) {
            const { data: perfis } = await supabase.from('perfis').select('id, nome_completo').in('id', ids);
            (perfis || []).forEach((p) => {
                nomeMap[p.id] = p.nome_completo || 'Colaborador';
            });
        }
        return data.map((r) => ({
            ...r,
            _autor_nome: nomeMap[r.id_usuario] || 'Colaborador'
        }));
    }

    try {
        const raw = localStorage.getItem(moinhoIdeiasStorageKey());
        const arr = raw ? JSON.parse(raw) : [];
        return arr.map((r) => ({
            ...r,
            _autor_nome: 'Você (somente neste aparelho)'
        }));
    } catch (_) {
        return [];
    }
}

async function carregarListaMoinhoIdeias() {
    const lista = document.getElementById('lista-moinho-ideias');
    if (!lista || !estado.usuario) return;
    lista.innerHTML = '<div class="centro">Carregando…</div>';
    const itens = await listarMelhoriasMoinhoIdeias();
    lista.innerHTML = '';
    if (!itens.length) {
        lista.innerHTML =
            '<div class="card centro" style="padding:2rem;color:#666;">Nenhuma melhoria registrada ainda.</div>';
        lucide.createIcons();
        return;
    }
    itens.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.marginBottom = '1rem';
        const fotos = (item.fotos || [])
            .map((u) => `<a href="${String(u).replace(/"/g, '&quot;')}" target="_blank" rel="noopener"><img src="${String(u).replace(/"/g, '&quot;')}" class="thumb-img" alt=""></a>`)
            .join('');
        const dataFmt = item.criado_em ? new Date(item.criado_em).toLocaleString('pt-BR') : '';
        const esc = (t) =>
            String(t || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/\n/g, '<br>');
        const autor = esc(item._autor_nome || 'Colaborador');
        const podeExcluirMoinho = estado.usuario && item.id_usuario === estado.usuario.id;
        div.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:0.75rem;">
                <div style="flex:1;min-width:200px;">
                    <p style="margin:0 0 0.35rem 0;font-size:0.8rem;color:#64748b;"><i data-lucide="user" style="width:14px;height:14px;vertical-align:middle;"></i> ${autor}</p>
                    <strong style="color:var(--cor-primaria);">${esc((item.descricao || '').length > 200 ? (item.descricao || '').slice(0, 200) + '…' : item.descricao || '')}</strong>
                </div>
                ${podeExcluirMoinho ? `<button type="button" class="btn btn-outline btn-excluir-moinho" data-moinho-id="${item.id}" style="font-size:0.8rem;height:auto;padding:0.35rem 0.65rem;color:#b91c1c;border-color:#fecaca;">Excluir</button>` : ''}
            </div>
            ${item.antes ? `<p style="font-size:0.9rem;margin:0.25rem 0;"><strong>Antes:</strong> ${esc(item.antes)}</p>` : ''}
            ${item.depois ? `<p style="font-size:0.9rem;margin:0.25rem 0;"><strong>Depois:</strong> ${esc(item.depois)}</p>` : ''}
            ${item.ganhos ? `<p style="font-size:0.9rem;margin:0.25rem 0;"><strong>Ganhos:</strong> ${esc(item.ganhos)}</p>` : ''}
            ${fotos ? `<div class="imgs-galeria" style="margin-top:0.75rem;">${fotos}</div>` : ''}
            ${dataFmt ? `<p style="font-size:0.8rem;color:#888;margin-top:0.75rem;">${dataFmt}</p>` : ''}
        `;
        lista.appendChild(div);
        div.querySelector('.btn-excluir-moinho')?.addEventListener('click', () => excluirMelhoriaMoinhoIdeias(item.id));
    });
    lucide.createIcons();
}

async function excluirMelhoriaMoinhoIdeias(id) {
    if (!id || !estado.usuario) return;
    const result = await Swal.fire({
        title: 'Excluir este registro?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        confirmButtonText: 'Excluir',
        cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed) return;
    const { error } = await supabase.from('melhorias_moinho').delete().eq('id', id).eq('id_usuario', estado.usuario.id);
    if (!error) {
        mostrarSucesso('Registro excluído.');
        await carregarListaMoinhoIdeias();
        return;
    }
    try {
        const raw = localStorage.getItem(moinhoIdeiasStorageKey()) || '[]';
        const arr = JSON.parse(raw).filter((x) => x.id !== id);
        localStorage.setItem(moinhoIdeiasStorageKey(), JSON.stringify(arr));
        mostrarSucesso('Registro excluído.');
        await carregarListaMoinhoIdeias();
    } catch (e) {
        mostrarErro('Erro', e.message || 'Não foi possível excluir.');
    }
}

document.getElementById('form-moinho-ideias')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!estado.usuario) return;
    const desc = document.getElementById('moinho-descricao')?.value?.trim() || '';
    const antes = document.getElementById('moinho-antes')?.value?.trim() || '';
    const situacaoDepois = document.getElementById('moinho-depois')?.value?.trim() || '';
    const ganhos = document.getElementById('moinho-ganhos')?.value?.trim() || '';
    const inputFotos = document.getElementById('moinho-fotos');
    const arquivos = Array.from(inputFotos?.files || []);
    if (!desc) {
        mostrarErro('Campos', 'Informe a descrição da melhoria.');
        return;
    }
    const btn = e.target.querySelector('button[type="submit"]');
    const txtOrig = btn?.innerHTML;
    btn.disabled = true;
    try {
        const urlsFotos = [];
        for (let i = 0; i < arquivos.length; i++) {
            if (btn) btn.innerHTML = `Enviando imagem ${i + 1}/${arquivos.length}…`;
            const arquivo = arquivos[i];
            const nomeLimpo = arquivo.name.replace(/[^a-zA-Z0-9.]/g, '_');
            const caminho = `melhorias_moinho/${estado.usuario.id}/${Date.now()}_${i}_${nomeLimpo}`;
            const { error: upErr } = await supabase.storage.from('fotos_apontamentos').upload(caminho, arquivo);
            if (upErr) throw new Error(upErr.message || 'Falha no upload da imagem.');
            const { data: urlData } = supabase.storage.from('fotos_apontamentos').getPublicUrl(caminho);
            if (urlData?.publicUrl) urlsFotos.push(urlData.publicUrl);
        }
        const payload = {
            id_usuario: estado.usuario.id,
            descricao: desc,
            antes: antes || null,
            depois: situacaoDepois || null,
            ganhos: ganhos || null,
            fotos: urlsFotos,
            criado_em: new Date().toISOString()
        };
        const { data: insRows, error: insErr } = await supabase.from('melhorias_moinho').insert([payload]).select('id');
        if (!insErr && insRows?.length) {
            mostrarSucesso('Melhoria registrada!');
            e.target.reset();
            fecharFormularioMoinhoIdeias();
            await carregarListaMoinhoIdeias();
            return;
        }
        const localRow = {
            ...payload,
            id: crypto.randomUUID()
        };
        const raw = localStorage.getItem(moinhoIdeiasStorageKey()) || '[]';
        const arr = JSON.parse(raw);
        arr.unshift(localRow);
        localStorage.setItem(moinhoIdeiasStorageKey(), JSON.stringify(arr));
        mostrarSucesso(
            'Melhoria salva neste dispositivo. Para sincronizar na equipe, execute supabase_setup_melhorias_moinho.sql no Supabase.'
        );
        e.target.reset();
        fecharFormularioMoinhoIdeias();
        await carregarListaMoinhoIdeias();
    } catch (err) {
        mostrarErro('Erro', err.message || 'Não foi possível salvar.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = txtOrig || '<i data-lucide="save"></i> Salvar melhoria';
        }
        lucide.createIcons();
    }
});

document.getElementById('btn-menu-moinho-ideias')?.addEventListener('click', () => navegarPara('moinhoIdeias'));
document.getElementById('btn-moinho-toggle-form')?.addEventListener('click', () => alternarFormularioMoinhoIdeias());
document.getElementById('btn-moinho-cancelar-form')?.addEventListener('click', () => {
    fecharFormularioMoinhoIdeias();
    document.getElementById('form-moinho-ideias')?.reset();
});
document.getElementById('btn-menu-preventivas')?.addEventListener('click', () => navegarPara('preventivas'));

let filtrosAdmin = {
    unidade: '',
    centro: '',
    dataInicio: '',
    dataFim: ''
};

async function renderAdminEquipamentosSolicitacoes(usuariosData) {
    const el = document.getElementById('admin-equip-solicitacoes-list');
    if (!el) return;
    if (estado.perfil?.funcao !== 'admin') {
        el.innerHTML = '';
        return;
    }
    el.innerHTML = '<p class="admin-equip-sol-carregando">Carregando solicitações…</p>';
    const nomePorId = new Map(
        (usuariosData || []).map((u) => [u.id, String(u.nome_completo || u.email || 'Usuário').trim() || 'Usuário'])
    );
    const { data, error } = await supabase
        .from('equipamentos_extras_solicitacoes')
        .select('id, unidade_chave, nome, id_solicitante, created_at')
        .eq('status', 'pendente')
        .order('created_at', { ascending: false });
    if (error) {
        if (String(error.message || '').includes('does not exist')) {
            el.innerHTML =
                '<p class="admin-equip-sol-vazio">Execute o script <strong>supabase_setup_equipamentos_extras_solicitacoes.sql</strong> no Supabase para habilitar a fila de aprovação de equipamentos.</p>';
        } else {
            el.innerHTML = `<p class="admin-equip-sol-vazio">${escaparHtmlBasico(error.message || 'Erro ao carregar.')}</p>`;
        }
        return;
    }
    const rows = data || [];
    if (rows.length === 0) {
        el.innerHTML = '<p class="admin-equip-sol-vazio">Nenhuma solicitação de equipamento pendente.</p>';
        return;
    }
    el.innerHTML = rows
        .map((r) => {
            const unidadeTxt = escaparHtmlBasico(rotuloUnidadePorChaveEquipamento(r.unidade_chave));
            const nomeEq = escaparHtmlBasico(String(r.nome || ''));
            const sol = escaparHtmlBasico(nomePorId.get(r.id_solicitante) || 'Solicitante');
            const rid = String(r.id || '').replace(/"/g, '');
            const quando = r.created_at
                ? new Date(r.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '';
            return `<div class="admin-equip-sol-item" data-sol-id="${rid}">
                <div class="admin-equip-sol-item-corpo">
                    <strong class="admin-equip-sol-nome">${nomeEq}</strong>
                    <p class="admin-equip-sol-meta">${unidadeTxt}${quando ? ` · ${escaparHtmlBasico(quando)}` : ''}</p>
                    <p class="admin-equip-sol-meta">Solicitante: ${sol}</p>
                </div>
                <div class="admin-equip-sol-acoes">
                    <button type="button" class="btn btn-primario btn-sm admin-equip-sol-btn-aprovar" data-sol-id="${rid}" style="text-transform:none;">Aprovar</button>
                    <button type="button" class="btn btn-outline btn-sm admin-equip-sol-btn-recusar" data-sol-id="${rid}" style="text-transform:none;color:#b91c1c;border-color:#fecaca;">Recusar</button>
                </div>
            </div>`;
        })
        .join('');
    lucide.createIcons();
}

async function carregarDadosAdmin() {
    const lista = document.getElementById('lista-admin');
    const listaUsuarios = document.getElementById('lista-usuarios-admin');

    lista.innerHTML = '<div class="centro">Carregando...</div>';
    listaUsuarios.innerHTML = '<div class="centro">Carregando...</div>';

    const { data: usuariosData, error: usuariosError } = await supabase
        .from('perfis')
        .select('id, nome_completo, email, telefone, cpf, tag, funcao, criado_em, foto_url')
        .order('nome_completo');

    estado.adminPerfisLista = usuariosData || [];
    await renderAdminEquipamentosSolicitacoes(estado.adminPerfisLista);

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
                const avatar = user.foto_url
                    ? `<img src="${String(user.foto_url).replace(/"/g, '&quot;')}" class="avatar-usuario-admin" width="40" height="40" alt="">`
                    : `<span class="avatar-usuario-admin avatar-usuario-placeholder"><i data-lucide="user"></i></span>`;
                div.innerHTML = `
                    <button class="accordion-header" onclick="toggleAccordion('${accordionId}')">
                        <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                                <i data-lucide="chevron-down" class="accordion-icon" id="icon-${accordionId}" style="width:20px; height:20px; transition:transform 0.3s;"></i>
                                ${avatar}
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
                                <strong>Contato (e-mail/WhatsApp):</strong> ${user.email || user.telefone || 'N/A'}
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
                                <button class="btn btn-outline" style="font-size: 0.85rem; padding: 0.5rem; height: auto; grid-column: 1 / -1;" onclick="trocarContatoPorNumero('${user.id}', '${String(user.email || '').replace(/'/g, '&#39;')}')">
                                    <i data-lucide="smartphone" style="width:14px; height:14px;"></i> Trocar e-mail por número
                                </button>
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

document.getElementById('admin-equip-solicitacoes-wrap')?.addEventListener('click', async (e) => {
    const btnA = e.target.closest('.admin-equip-sol-btn-aprovar');
    const btnR = e.target.closest('.admin-equip-sol-btn-recusar');
    if (!btnA && !btnR) return;
    if (estado.perfil?.funcao !== 'admin') return;
    const id = (btnA || btnR).getAttribute('data-sol-id');
    if (!id) return;
    if (btnR) {
        const { isConfirmed } = await Swal.fire({
            icon: 'warning',
            title: 'Recusar solicitação?',
            text: 'O equipamento não será incluído na lista das unidades.',
            showCancelButton: true,
            confirmButtonText: 'Sim, recusar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#b91c1c'
        });
        if (!isConfirmed) return;
        const ok = await rejeitarSolicitacaoEquipamentoAdmin(id);
        if (!ok) return;
        mostrarSucesso('Solicitação recusada.');
    } else {
        const { data: row, error } = await supabase
            .from('equipamentos_extras_solicitacoes')
            .select('*')
            .eq('id', id)
            .single();
        if (error || !row) {
            mostrarErro('Aprovar', 'Registro não encontrado ou já processado.');
            return;
        }
        const ok = await aprovarSolicitacaoEquipamentoAdmin(row);
        if (!ok) return;
        mostrarSucesso('Equipamento aprovado e liberado na lista.');
    }
    await renderAdminEquipamentosSolicitacoes(estado.adminPerfisLista || []);
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

        const podeEditar = isAdmin || (log.id_usuario === estado.usuario?.id) || (log.id_manutentor === estado.usuario?.id);

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
            <div style="display:flex; align-items:stretch; width:100%; flex-wrap:wrap;">
                <button type="button" class="accordion-header" style="flex:1; min-width:200px; width:auto;" onclick="toggleAccordion('${accordionId}')">
                    <div style="display:flex; align-items:center; gap:10px; width:100%; min-width:0;">
                        <i data-lucide="chevron-down" class="accordion-icon" id="icon-${accordionId}" style="width:20px; height:20px; transition:transform 0.3s; flex-shrink:0;"></i>
                        <span style="font-weight:800; color:var(--cor-primaria); flex-shrink:0;"># ${log.numero_ordem}</span>
                        <span style="font-size:0.9rem; color:#666; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0;">
                            ${log.descricao.length > 40 ? log.descricao.substring(0, 40) + '...' : log.descricao}
                        </span>
                    </div>
                </button>
                <div style="display:flex; gap:8px; align-items:center; flex-shrink:0; flex-wrap:wrap; padding:0.65rem 1rem; background:var(--branco); border-top:1px solid #eef2f7;" onclick="event.stopPropagation();">
                    ${podeEditar ? `
                    <button type="button" class="btn btn-outline hist-btn-editar" data-apt-id="${log.id}" style="font-size:0.8rem; padding:0.35rem 0.65rem; height:auto; text-transform:none;">
                        <i data-lucide="edit-2" style="width:14px;height:14px;"></i> Editar
                    </button>
                    <button type="button" class="btn btn-outline hist-btn-excluir" data-apt-id="${log.id}" style="font-size:0.8rem; padding:0.35rem 0.65rem; height:auto; text-transform:none; color:#b91c1c;border-color:#fecaca;">
                        <i data-lucide="trash-2" style="width:14px;height:14px;"></i> Excluir
                    </button>` : ''}
                    <span class="badge ${log.concluido ? 'badge-ok' : 'badge-wait'}">
                        ${log.concluido ? 'CONCLUÍDO' : 'PENDENTE'}
                    </span>
                </div>
            </div>
            <div class="accordion-content" id="${accordionId}">
                <div style="font-size: 0.95rem; color: #444; padding-top: 1rem;">
                    <p style="margin-bottom:4px;"><strong>${log.descricao}</strong></p>
                    <p style="font-size:0.85rem; color:#666;">
                        <i data-lucide="map-pin" style="width:14px; height:14px; vertical-align:middle;"></i> 
                        ${log.unidade || '—'}${log.setor_centro ? ' · ' + String(log.setor_centro).replace(/</g, '&lt;') : ''} • ${log.centro_trabalho || '—'}
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

        const btnEditar = div.querySelector('.hist-btn-editar');
        if (btnEditar) {
            btnEditar.addEventListener('click', (e) => {
                e.stopPropagation();
                abrirEdicaoApontamento(log);
            });
        }
        const btnExcluir = div.querySelector('.hist-btn-excluir');
        if (btnExcluir) {
            btnExcluir.addEventListener('click', (e) => {
                e.stopPropagation();
                excluirApontamentoConfirmar(log);
            });
        }
    });
    lucide.createIcons();
}

window.toggleAccordion = function (id) {
    const content = document.getElementById(id);
    const icon = document.getElementById(`icon-${id}`);

    if (content.classList.contains('active')) {
        content.classList.remove('active');
        if (icon) {
            icon.style.transform = 'rotate(0deg)';
        }
    } else {
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
            'Setor / Unidade': item.unidade || '',
            'Setor (código MT)': item.setor_centro || '',
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

document.getElementById('btn-download-os-abertas')?.addEventListener('click', async () => {
    Swal.fire({
        title: 'Gerando planilha…',
        didOpen: () => Swal.showLoading()
    });
    const { data, error } = await supabase
        .from('ordens_servico')
        .select('*')
        .eq('status', 'aberta')
        .order('criado_em', { ascending: false });
    Swal.close();
    if (error) {
        mostrarErro('Erro', error.message);
        return;
    }
    const arr = data || [];
    const dadosFormatados = arr.length
        ? arr.map((os) => ({
            Número: os.numero_solicitacao || '',
            Descrição: (os.descricao || os.titulo || '').replace(/\s+/g, ' ').trim(),
            'Setor / Unidade': os.setor || os.unidade || '',
            'Setor (código MT)': os.setor_centro || '',
            'Avaliação (1-5)': os.avaliacao_solicitante != null ? String(os.avaliacao_solicitante) : '',
            Equipamento: os.equipamento || '',
            'Centro de Trabalho': os.centro_trabalho || '',
            Prioridade: os.prioridade || '',
            Destino: os.destino_servico || '',
            'Tipo manutenção': os.tipo_manutencao || '',
            'Data necessidade': os.data_necessidade || '',
            Status: os.status || '',
            'Criado em': os.criado_em ? new Date(os.criado_em).toLocaleString('pt-BR') : ''
        }))
        : [{ Aviso: 'Nenhuma OS aberta no momento' }];
    const ws = XLSX.utils.json_to_sheet(dadosFormatados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'OS_abertas');
    XLSX.writeFile(wb, `Relatorio_OS_abertas_${new Date().toISOString().split('T')[0]}.xlsx`);
    Toast.fire({ icon: 'success', title: 'Download concluído!' });
});

document.getElementById('btn-download-avaliacoes')?.addEventListener('click', async () => {
    Swal.fire({
        title: 'Gerando planilha de avaliações…',
        didOpen: () => Swal.showLoading()
    });
    const { data: ordens, error } = await supabase
        .from('ordens_servico')
        .select('*')
        .not('avaliacao_solicitante', 'is', null)
        .order('avaliacao_solicitante_em', { ascending: false });
    Swal.close();
    if (error) {
        const msg = String(error.message || '');
        mostrarErro(
            'Erro',
            msg.toLowerCase().includes('column') || msg.toLowerCase().includes('schema')
                ? 'Colunas de avaliação ausentes. Execute supabase_add_setor_centro_avaliacao_os.sql no Supabase.'
                : msg
        );
        return;
    }
    const arr = ordens || [];
    const idsSol = [...new Set(arr.map((o) => o.id_solicitante).filter(Boolean))];
    let nomePorId = {};
    let emailPorId = {};
    if (idsSol.length) {
        const { data: perfis } = await supabase.from('perfis').select('id, nome_completo, email').in('id', idsSol);
        (perfis || []).forEach((p) => {
            nomePorId[p.id] = p.nome_completo || '';
            emailPorId[p.id] = p.email || '';
        });
    }
    const dadosFormatados = arr.length
        ? arr.map((os) => ({
              'Número OS': os.numero_solicitacao || '',
              'Nota (1 a 5)': os.avaliacao_solicitante != null ? Number(os.avaliacao_solicitante) : '',
              'Data/hora da avaliação': os.avaliacao_solicitante_em
                  ? new Date(os.avaliacao_solicitante_em).toLocaleString('pt-BR')
                  : '',
              'Solicitante': nomePorId[os.id_solicitante] || '',
              'E-mail solicitante': emailPorId[os.id_solicitante] || '',
              'Setor / Unidade': os.setor || os.unidade || '',
              'Setor (código MT)': os.setor_centro || '',
              Equipamento: os.equipamento || '',
              'Centro de trabalho': os.centro_trabalho || '',
              Status: os.status || '',
              Descrição: (os.descricao || os.titulo || '').replace(/\s+/g, ' ').trim(),
              'OS criada em': os.criado_em ? new Date(os.criado_em).toLocaleString('pt-BR') : '',
              'Última atualização': os.atualizado_em ? new Date(os.atualizado_em).toLocaleString('pt-BR') : ''
          }))
        : [{ Aviso: 'Nenhuma avaliação registrada até o momento' }];
    const ws = XLSX.utils.json_to_sheet(dadosFormatados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Avaliacoes');
    XLSX.writeFile(wb, `Relatorio_avaliacoes_OS_${new Date().toISOString().split('T')[0]}.xlsx`);
    Toast.fire({ icon: 'success', title: 'Avaliações exportadas!' });
});

const DEPARTAMENTOS = ['Elétrica', 'Mecânica', 'Automação'];

function numeroOsParaProgramacao(os, osId) {
    const n = String(os?.numero_solicitacao || '').trim();
    if (/^\d+$/.test(n)) return n;
    return String(osId || '').slice(0, 8).replace(/-/g, '');
}

function normalizarChaveNumeroOs(num) {
    const t = String(num || '').trim();
    if (/^\d+$/.test(t)) return String(parseInt(t, 10));
    return t;
}

function chaveParProgramacaoAdmin(os, osId, colabId) {
    return `${normalizarChaveNumeroOs(numeroOsParaProgramacao(os, osId))}|${colabId}`;
}

function atualizarProgAdminCheckboxesDesabilitados() {
    const osId = document.getElementById('prog-admin-os-select')?.value || '';
    const lista = estado.progAdminListaOs;
    const chaves = estado.progAdminChavesOcupadas;
    const os = osId && lista ? lista.find((o) => o.id === osId) : null;
    document.querySelectorAll('.prog-admin-colab-cb').forEach((cb) => {
        if (!os || !chaves) {
            cb.disabled = true;
            cb.checked = false;
            return;
        }
        const ocupada = chaves.has(chaveParProgramacaoAdmin(os, os.id, cb.value));
        cb.disabled = ocupada;
        if (ocupada) cb.checked = false;
    });
}

async function carregarProgramacoesAdmin() {
    if (estado.perfil?.funcao !== 'admin') return;
    const lista = document.getElementById('lista-programacoes-admin');
    const listaOs = document.getElementById('prog-admin-os-abertas-lista');
    const selOs = document.getElementById('prog-admin-os-select');
    const colabsWrap = document.getElementById('prog-admin-colabs-checkboxes');
    const dataProgInput = document.getElementById('prog-admin-data-prog');
    if (!lista) return;

    if (dataProgInput && !dataProgInput.value) {
        dataProgInput.value = new Date().toISOString().slice(0, 10);
    }

    if (listaOs) listaOs.innerHTML = '<div class="centro" style="padding:1rem;">Carregando…</div>';
    lista.innerHTML = '<div class="centro" style="padding: 1rem;">Carregando programações…</div>';
    if (selOs) {
        selOs.innerHTML = '<option value="">Selecione a OS…</option>';
        selOs.disabled = true;
    }
    if (colabsWrap) colabsWrap.innerHTML = '<p class="prog-admin-vazio" style="padding:0.5rem;">Carregando colaboradores…</p>';

    await carregarUsuarios();
    const colabs = (estado.usuarios || []).filter(
        (u) => u.funcao !== 'admin' && (u.tipo_perfil === 'manutencao' || !u.tipo_perfil || u.tipo_perfil === '')
    );

    const { data: ordensMix, error: errOrdens } = await supabase
        .from('ordens_servico')
        .select('*')
        .in('status', ['aberta', 'programada'])
        .order('criado_em', { ascending: false })
        .limit(250);

    const paraLista = ordensMix || [];

    const { data: todasProgChaves } = await supabase.from('programacoes').select('os_numero, id_colaborador');
    const chavesOcupadas = new Set(
        (todasProgChaves || []).map((p) => `${normalizarChaveNumeroOs(p.os_numero)}|${p.id_colaborador}`)
    );

    estado.progAdminListaOs = paraLista;
    estado.progAdminChavesOcupadas = chavesOcupadas;
    estado.progAdminColabs = colabs;

    if (listaOs) {
        if (errOrdens) {
            listaOs.innerHTML = `<p class="prog-admin-vazio">${String(errOrdens.message || 'Erro ao carregar OS.').replace(/</g, '&lt;')}</p>`;
        } else if (paraLista.length === 0) {
            listaOs.innerHTML = '<p class="prog-admin-vazio">Nenhuma OS disponível.</p>';
        } else {
            listaOs.innerHTML = paraLista
                .map((os) => {
                    const oid = String(os.id || '').replace(/"/g, '&quot;');
                    const num = String(os.numero_solicitacao || os.id?.slice(0, 8) || '—').replace(/</g, '&lt;');
                    const st = os.status === 'programada' ? ' <span class="prog-admin-badge-prog">Prog.</span>' : '';
                    const un = String(os.setor || os.unidade || '—').replace(/</g, '&lt;');
                    const centroTrab = String(os.centro_trabalho || '').replace(/</g, '&lt;').trim();
                    const centroTag = centroTrab ? ` · ${centroTrab}` : '';
                    const eq = os.equipamento ? ` · ${String(os.equipamento).replace(/</g, '&lt;')}` : '';
                    const desc = String(os.descricao || os.titulo || '—')
                        .replace(/</g, '&lt;')
                        .replace(/\s+/g, ' ')
                        .trim();
                    const curto = desc.length > 160 ? `${desc.slice(0, 160)}…` : desc;
                    return `<div class="prog-admin-os-aberta-item" data-os-id="${oid}" role="button" tabindex="0" title="Usar esta OS no formulário"><strong>#${num}</strong>${st} — ${un}${centroTag}${eq}<br><span class="prog-admin-os-desc-preview">${curto}</span></div>`;
                })
                .join('');
            listaOs.querySelectorAll('.prog-admin-os-aberta-item[data-os-id]').forEach((el) => {
                const escolher = () => {
                    const id = el.getAttribute('data-os-id');
                    const sel = document.getElementById('prog-admin-os-select');
                    if (sel && id) {
                        sel.value = id;
                        atualizarProgAdminCheckboxesDesabilitados();
                    }
                };
                el.addEventListener('click', escolher);
                el.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        escolher();
                    }
                });
            });
        }
    }

    if (selOs && !errOrdens && paraLista.length > 0) {
        selOs.disabled = false;
        paraLista.forEach((os) => {
            const opt = document.createElement('option');
            opt.value = os.id;
            const num = String(os.numero_solicitacao || os.id?.slice(0, 8) || '—');
            const un = String(os.setor || os.unidade || '').replace(/\s+/g, ' ').trim() || '—';
            const centroTrab = String(os.centro_trabalho || '').replace(/\s+/g, ' ').trim();
            let texto = `#${num} — ${un}${centroTrab ? ` · ${centroTrab}` : ''}`;
            if (texto.length > 96) texto = `${texto.slice(0, 93)}…`;
            opt.textContent = texto;
            selOs.appendChild(opt);
        });
    } else if (selOs) {
        selOs.innerHTML = `<option value="">${errOrdens ? 'Erro ao carregar OS' : 'Nenhuma OS disponível'}</option>`;
    }

    if (colabsWrap) {
        colabsWrap.innerHTML = '';
        if (colabs.length === 0) {
            colabsWrap.innerHTML = '<p class="prog-admin-vazio">Sem colaboradores de manutenção cadastrados.</p>';
        } else {
            colabs.forEach((c) => {
                const id = String(c.id || '').replace(/"/g, '&quot;');
                const nome = String(c.nome_completo || '—').replace(/</g, '&lt;');
                const lab = document.createElement('label');
                lab.className = 'prog-admin-colab-label';
                lab.innerHTML = `<input type="checkbox" class="prog-admin-colab-cb" value="${id}"> <span>${nome}</span>`;
                colabsWrap.appendChild(lab);
            });
        }
    }

    atualizarProgAdminCheckboxesDesabilitados();

    const { data: prog, error } = await supabase.from('programacoes').select('*').order('criado_em', { ascending: false });

    if (error) {
        lista.innerHTML = `<div class="card centro" style="padding: 2rem; color: #991b1b;">${error.message?.includes('does not exist') ? 'Tabela programacoes não encontrada. Execute supabase_setup_programacoes.sql' : error.message}</div>`;
        lucide.createIcons();
        return;
    }

    lista.innerHTML = '';
    if (!prog || prog.length === 0) {
        lista.innerHTML =
            '<div class="card centro" style="padding: 2rem 1rem;"><p style="color: #666;">Nenhuma programação registrada ainda.</p></div>';
        lucide.createIcons();
        return;
    }

    prog.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'card card-programacao';
        const nomeColab = estado.usuarios?.find((u) => u.id === p.id_colaborador)?.nome_completo || '—';
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
    lista.querySelectorAll('.btn-excluir-prog').forEach((btn) => {
        btn.addEventListener('click', () => excluirProgramacao(btn.dataset.id));
    });
    lucide.createIcons();
}

document.getElementById('prog-admin-os-select')?.addEventListener('change', atualizarProgAdminCheckboxesDesabilitados);

async function enviarWhatsappUltraMsg(numeroDestino, mensagem) {
    const numero = normalizarNumeroWhatsapp(numeroDestino);
    if (!numero) throw new Error('Número de WhatsApp inválido.');
    if (!ULTRAMSG_CONFIG.instanceId || !ULTRAMSG_CONFIG.token) {
        throw new Error('Configure ULTRAMSG_CONFIG.instanceId e ULTRAMSG_CONFIG.token no arquivo main.js.');
    }

    const url = `https://api.ultramsg.com/${encodeURIComponent(ULTRAMSG_CONFIG.instanceId)}/messages/chat`;
    const body = new URLSearchParams({
        token: ULTRAMSG_CONFIG.token,
        to: numero,
        body: mensagem
    });

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || (data && data.sent === false)) {
        throw new Error(data?.message || `Falha no envio (${resp.status}).`);
    }
    return data;
}

function mensagemProgramacaoWhatsapp(nomeAdmin) {
    const nome = String(nomeAdmin || 'Admin').trim();
    return `Você recebeu uma nova programação atribuída por ${nome}. Entre no sistema para ver mais detalhes.`;
}

document.getElementById('prog-admin-btn-programar')?.addEventListener('click', async () => {
    if (estado.perfil?.funcao !== 'admin') return;
    const osId = document.getElementById('prog-admin-os-select')?.value || '';
    const colabIds = [...document.querySelectorAll('.prog-admin-colab-cb:checked')]
        .map((cb) => cb.value)
        .filter(Boolean);
    const dataProg = document.getElementById('prog-admin-data-prog')?.value || new Date().toISOString().slice(0, 10);
    if (!osId) {
        mostrarErro('Seleção obrigatória', 'Escolha uma ordem de serviço na lista.');
        return;
    }
    if (colabIds.length === 0) {
        mostrarErro('Manutentores', 'Marque pelo menos um manutentor.');
        return;
    }
    try {
        const { data: os, error: e1 } = await supabase
            .from('ordens_servico')
            .select('titulo, descricao, setor, unidade, setor_centro, numero_solicitacao, status')
            .eq('id', osId)
            .single();
        if (e1 || !os) throw new Error('OS não encontrada.');
        if (os.status !== 'aberta' && os.status !== 'programada') {
            mostrarErro('OS', 'Só é possível programar OS em aberto ou já programadas (outro colaborador).');
            await carregarProgramacoesAdmin();
            try {
                carregarOrdensPendentes();
            } catch (_) { /* noop */ }
            return;
        }
        const numeroOs = numeroOsParaProgramacao(os, osId);
        const { data: progDup } = await supabase.from('programacoes').select('os_numero, id_colaborador');
        const ocupSet = new Set(
            (progDup || []).map((p) => `${normalizarChaveNumeroOs(p.os_numero)}|${p.id_colaborador}`)
        );
        const toAdd = colabIds.filter((cid) => !ocupSet.has(chaveParProgramacaoAdmin(os, osId, cid)));
        if (toAdd.length === 0) {
            mostrarErro('Programação', 'Todos os selecionados já estão nesta OS na programação.');
            return;
        }

        const sufixoCentro = os.setor_centro ? ` · ${os.setor_centro}` : '';
        const setorUnidade = `${os.unidade || ''} - ${os.setor || ''}${sufixoCentro}`.trim();
        const problema = montarProblemaOS(os.titulo, os.descricao);
        const jaProgramada = os.status === 'programada';
        const idResponsavelPrincipal = toAdd[0];

        if (!jaProgramada) {
            const { error: e2 } = await supabase
                .from('ordens_servico')
                .update({ status: 'programada', id_responsavel: idResponsavelPrincipal, atualizado_em: new Date().toISOString() })
                .eq('id', osId);
            if (e2) throw e2;
        }

        const linhas = toAdd.map((colabId) => ({
            id_colaborador: colabId,
            os_numero: numeroOs,
            setor_unidade: setorUnidade || '—',
            problema: problema || '—',
            data_programada: dataProg
        }));
        const { error: e3 } = await supabase.from('programacoes').insert(linhas);
        if (e3) {
            if (!jaProgramada) {
                await supabase
                    .from('ordens_servico')
                    .update({ status: 'aberta', id_responsavel: null, atualizado_em: new Date().toISOString() })
                    .eq('id', osId);
            }
            throw e3;
        }

        const nomeAdmin = (estado.perfil?.nome_completo || 'Admin').trim();
        const mensagemWhatsapp = mensagemProgramacaoWhatsapp(nomeAdmin);
        const contatosPorId = new Map();
        try {
            const { data: perfisContato } = await supabase
                .from('perfis')
                .select('id, email, telefone')
                .in('id', toAdd);
            (perfisContato || []).forEach((p) => {
                const contatoBruto = p?.telefone || p?.email || '';
                const numero = normalizarNumeroWhatsapp(contatoBruto);
                if (numero) contatosPorId.set(p.id, numero);
            });
        } catch (_) {
            // Mantem programação mesmo se falhar busca de contatos.
        }

        const envios = await Promise.allSettled(
            toAdd
                .map((cid) => contatosPorId.get(cid))
                .filter(Boolean)
                .map((numero) => enviarWhatsappUltraMsg(numero, mensagemWhatsapp))
        );
        const totalFalhasWhatsapp = envios.filter((r) => r.status === 'rejected').length;

        const n = toAdd.length;
        const msgBase = jaProgramada
                ? n > 1
                    ? `${n} colaboradores adicionados à mesma OS na programação diária.`
                    : 'Colaborador adicionado à mesma OS na programação diária.'
                : n > 1
                  ? `OS programada para ${n} colaboradores! Todos verão na programação diária e no apontamento.`
                  : 'OS programada! O colaborador verá na Programação diária e no apontamento.';

        if (totalFalhasWhatsapp > 0) {
            Toast.fire({
                icon: 'warning',
                title: `${msgBase} WhatsApp enviado com ${totalFalhasWhatsapp} falha(s).`
            });
        } else {
            mostrarSucesso(msgBase);
        }
        const sel = document.getElementById('prog-admin-os-select');
        if (sel) sel.value = '';
        document.querySelectorAll('.prog-admin-colab-cb').forEach((cb) => {
            cb.checked = false;
        });
        atualizarProgAdminCheckboxesDesabilitados();
        await carregarProgramacoesAdmin();
        try {
            carregarOrdensPendentes();
        } catch (_) { /* noop */ }
    } catch (err) {
        mostrarErro('Erro', err.message || 'Não foi possível programar.');
    }
});

async function carregarProgramacaoDiaria() {
    const lista = document.getElementById('lista-programacao-usuario');
    if (!lista) return;
    lista.innerHTML = '<div class="centro" style="padding: 2rem;">Carregando...</div>';

    const { data: progRaw, error } = await supabase
        .from('programacoes')
        .select('*')
        .eq('id_colaborador', estado.usuario?.id)
        .order('data_programada', { ascending: false });

    if (error) {
        lista.innerHTML = `<div class="card centro" style="padding: 2rem; color: #991b1b;">${error.message?.includes('does not exist') ? 'Execute supabase_setup_programacoes.sql' : error.message}</div>`;
        lucide.createIcons();
        return;
    }

    let prog = progRaw || [];
    if (prog.length > 0) {
        prog = await filtrarProgramacoesOsAindaAbertas(prog);
    }

    lista.innerHTML = '';
    if (!prog || prog.length === 0) {
        lista.innerHTML = '<div class="card centro" style="padding: 3rem 1rem;"><p style="color: #666;">Nenhuma programação ativa para você no momento.</p><p style="color:#888;font-size:0.85rem;margin-top:0.5rem;">OS já concluídas ou canceladas não aparecem aqui.</p></div>';
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
        title: 'Programação manual (avançado)',
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
            try {
                const { data: perfilDestino } = await supabase
                    .from('perfis')
                    .select('email, telefone')
                    .eq('id', form.id_colaborador)
                    .maybeSingle();
                const numeroDestino = normalizarNumeroWhatsapp(perfilDestino?.telefone || perfilDestino?.email || '');
                if (numeroDestino) {
                    await enviarWhatsappUltraMsg(
                        numeroDestino,
                        mensagemProgramacaoWhatsapp(estado.perfil?.nome_completo || 'Admin')
                    );
                }
            } catch (_) {
                // Nao impede a programacao manual caso falhe o envio do WhatsApp.
            }
            mostrarSucesso('Programação criada!');
            carregarProgramacoesAdmin();
        } catch (e) {
            mostrarErro('Erro', e.message || 'Não foi possível salvar.');
        }
    }
});

async function excluirProgramacao(id) {
    if (estado.perfil?.funcao !== 'admin') return;
    const result = await Swal.fire({
        title: 'Excluir programação?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Excluir'
    });
    if (result.isConfirmed) {
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
    const result = await Swal.fire({
        title: 'Excluir veículo?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Excluir'
    });
    if (result.isConfirmed) {
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


async function carregarBancoHoras() {
    const lista = document.getElementById('lista-banco-horas');
    lista.innerHTML = '<div class="centro">Carregando...</div>';

    const usuarioLogadoId = estado.usuario?.id;
    if (!usuarioLogadoId) {
        lista.innerHTML = '<p class="centro">Faça login para ver seu banco de horas.</p>';
        return;
    }

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
                    <div style="font-size: 1.5rem; font-weight: 700; color: #065f46;">${formatarHorasComMinutos(usuario.horasPositivas, true)}</div>
                </div>
                <div style="padding: 1rem; background: #fee2e2; border-radius: 8px;">
                    <div style="font-size: 0.85rem; color: #991b1b; margin-bottom: 5px;">Horas Negativas</div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: #991b1b;">-${formatarHorasComMinutos(Math.abs(usuario.horasNegativas)).replace('h', '')}h</div>
                </div>
            </div>
            <div style="padding: 1rem; background: #dbeafe; border-radius: 8px; margin-bottom: 1rem;">
                <div style="font-size: 0.85rem; color: #1e40af; margin-bottom: 5px;">Total Banco de Horas</div>
                <div style="font-size: 1.8rem; font-weight: 700; color: #1e40af;">${formatarHorasComMinutos(usuario.total, true)}</div>
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
    const result = await Swal.fire({
        title: 'Excluir registro?',
        text: 'Esta ação não pode ser desfeita.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Excluir'
    });
    if (result.isConfirmed) {
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

    if (estado.usuarios.length === 0) {
        await carregarUsuarios();
    }

    const { data: usuarios, error: errorUsuarios } = await supabase
        .from('perfis')
        .select('id, nome_completo')
        .order('nome_completo');

    if (errorUsuarios) {
        lista.innerHTML = '<p class="centro">Erro ao carregar dados.</p>';
        return;
    }

    const { data: horasSalvas, error: errorHoras } = await supabase
        .from('horas_usuarios')
        .select('id_usuario, ferias');

    let usuariosArray = [...usuarios];
    const usuarioLogadoId = estado.usuario?.id;

    usuariosArray.sort((a, b) => {
        if (a.id === usuarioLogadoId) return -1;
        if (b.id === usuarioLogadoId) return 1;
        return a.nome_completo.localeCompare(b.nome_completo);
    });

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
    const horasPositivas = normalizarValorHoras(dados.horas_positivas);
    const horasNegativas = normalizarValorHoras(dados.horas_negativas);
    const horasExtras = normalizarValorHoras(dados.horas_extras);
    const horasExtrasFimSemana = normalizarValorHoras(dados.horas_extras_fim_semana);

    if ([horasPositivas, horasNegativas, horasExtras, horasExtrasFimSemana].some((valor) => Number.isNaN(valor))) {
        throw new Error('Formato de horas inválido. Use decimal (1.5) ou HH:MM (01:30).');
    }

    const { data, error } = await supabase
        .from('horas_usuarios')
        .upsert({
            id_usuario: userId,
            horas_positivas: horasPositivas,
            horas_negativas: horasNegativas,
            horas_extras: horasExtras,
            horas_extras_fim_semana: horasExtrasFimSemana,
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

window.trocarContatoPorNumero = async function (userId, contatoAtual = '') {
    if (estado.perfil?.funcao !== 'admin') {
        mostrarErro('Acesso Restrito', 'Apenas administradores podem alterar contato de usuário.');
        return;
    }

    const numeroSugerido = normalizarNumeroWhatsapp(contatoAtual || '');
    const { value: valor } = await Swal.fire({
        title: 'Trocar e-mail por número',
        input: 'text',
        inputLabel: 'Número de WhatsApp (com DDD)',
        inputValue: numeroSugerido,
        inputPlaceholder: '5514998598003',
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        inputValidator: (v) => {
            const n = normalizarNumeroWhatsapp(v);
            if (!n || n.length < 10) return 'Informe um número válido com DDD.';
            return null;
        }
    });

    if (!valor) return;
    const numero = normalizarNumeroWhatsapp(valor);
    const payload = { email: numero, telefone: numero };

    const { error } = await supabase.from('perfis').update(payload).eq('id', userId);
    if (error) {
        mostrarErro('Contato', error.message || 'Não foi possível atualizar o número.');
        return;
    }
    mostrarSucesso('Contato atualizado para WhatsApp!');
    await carregarDadosAdmin();
};

window.editarBancoHoras = async function (userId) {
    if (estado.perfil?.funcao !== 'admin') {
        mostrarErro('Acesso Restrito', 'Apenas administradores podem editar essas informações.');
        return;
    }

    const horasAtuais = await buscarHorasUsuario(userId);

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
                <input id="swal-horas-positivas" class="swal2-input" type="text" value="${formatarHorasComMinutos(horasAtuais.horas_positivas || 0).replace('h', '')}" placeholder="Ex: 08:30" style="margin-bottom: 1rem;">
                
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #991b1b;">Horas Negativas:</label>
                <input id="swal-horas-negativas" class="swal2-input" type="text" value="${formatarHorasComMinutos(horasAtuais.horas_negativas || 0).replace('h', '')}" placeholder="Ex: 01:15" style="margin-bottom: 1rem;">
                <div style="padding:0.75rem; border-radius:8px; background:#dbeafe; margin-top:0.75rem;">
                    <div style="font-size:0.8rem; color:#1e40af; margin-bottom:0.25rem;">Total Banco de Horas</div>
                    <div id="swal-banco-total" style="font-weight:700; color:#1e40af; font-size:1.2rem;">${formatarHorasComMinutos((horasAtuais.horas_positivas || 0) - (horasAtuais.horas_negativas || 0), true)}</div>
                </div>
                <p style="margin:0.5rem 0 0; font-size:0.8rem; color:#64748b;">Aceita decimal (1.5) ou com minutos (01:30).</p>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#004175',
        didOpen: () => {
            const inputPos = document.getElementById('swal-horas-positivas');
            const inputNeg = document.getElementById('swal-horas-negativas');
            const totalEl = document.getElementById('swal-banco-total');
            const atualizarTotal = () => {
                const positivas = normalizarValorHoras(inputPos?.value);
                const negativas = normalizarValorHoras(inputNeg?.value);
                if (Number.isNaN(positivas) || Number.isNaN(negativas)) {
                    totalEl.textContent = '--:--h';
                    return;
                }
                totalEl.textContent = formatarHorasComMinutos(positivas - negativas, true);
            };
            inputPos?.addEventListener('input', atualizarTotal);
            inputNeg?.addEventListener('input', atualizarTotal);
            atualizarTotal();
        },
        preConfirm: () => {
            const horasPositivas = normalizarValorHoras(document.getElementById('swal-horas-positivas').value);
            const horasNegativas = normalizarValorHoras(document.getElementById('swal-horas-negativas').value);
            if (Number.isNaN(horasPositivas) || Number.isNaN(horasNegativas)) {
                Swal.showValidationMessage('Formato inválido. Use decimal (1.5) ou HH:MM (01:30).');
                return false;
            }
            return {
                horas_positivas: horasPositivas,
                horas_negativas: horasNegativas,
                horas_extras: horasAtuais.horas_extras || 0,
                horas_extras_fim_semana: horasAtuais.horas_extras_fim_semana || 0,
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

    const horasAtuais = await buscarHorasUsuario(userId);

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

    const horasAtuais = await buscarHorasUsuario(userId);

    let usuario = estado.usuarios.find(u => u.id === userId);
    if (!usuario) {
        const { data: perfilData } = await supabase
            .from('perfis')
            .select('nome_completo')
            .eq('id', userId)
            .single();
        usuario = { nome_completo: perfilData?.nome_completo || 'Usuário' };
    }

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

const CHART_THEME = {
    primary: '#004175',
    primaryMid: '#1e6fa3',
    primaryLight: '#4a8eb8',
    grid: 'rgba(15, 23, 42, 0.06)',
    fill: 'rgba(0, 65, 117, 0.12)'
};

function destruirChartCanvas(canvasId) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === 'undefined') return;
    try {
        const c = Chart.getChart(el);
        if (c) c.destroy();
    } catch (_) { /* noop */ }
}

function obterOpcoesGraficoRoscaDashboard() {
    const narrow = typeof window !== 'undefined' && window.innerWidth <= 520;
    return {
        responsive: true,
        maintainAspectRatio: false,
        cutout: narrow ? '52%' : '62%',
        layout: { padding: narrow ? 6 : 14 },
        plugins: {
            legend: {
                position: 'bottom',
                labels: {
                    usePointStyle: true,
                    boxWidth: narrow ? 7 : 9,
                    padding: narrow ? 8 : 14,
                    font: { size: narrow ? 10 : 12 }
                }
            }
        }
    };
}

/** Rosca admin: vários status de OS — legenda mais compacta para não estourar à direita no mobile. */
function obterOpcoesGraficoRoscaDashboardAdmin(numCategorias) {
    const narrow = typeof window !== 'undefined' && window.innerWidth <= 520;
    const w = typeof window !== 'undefined' ? window.innerWidth : 400;
    const legMax = Math.max(100, Math.min(300, w - 48));
    const extras = Math.max(0, (numCategorias || 1) - 2);
    const padB = narrow ? 4 + extras * 12 : 8 + extras * 8;
    return {
        responsive: true,
        maintainAspectRatio: false,
        cutout: narrow ? '50%' : '60%',
        layout: {
            padding: narrow
                ? { top: 2, right: 2, bottom: padB, left: 2 }
                : { top: 8, right: 8, bottom: padB, left: 8 }
        },
        plugins: {
            legend: {
                position: 'bottom',
                maxWidth: legMax,
                align: 'center',
                labels: {
                    usePointStyle: true,
                    boxWidth: narrow ? 6 : 8,
                    padding: narrow ? 4 : 10,
                    font: { size: narrow ? 9 : 11 }
                }
            }
        }
    };
}

function redimensionarChartsDashboardAtrasado() {
    if (typeof Chart === 'undefined') return;
    const ids = ['chart-status-mes', 'chart-admin-os-status'];
    const rodar = () => {
        ids.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            try {
                const ch = Chart.getChart(el);
                if (ch) {
                    ch.resize();
                    ch.update('none');
                }
            } catch (_) { /* noop */ }
        });
    };
    requestAnimationFrame(rodar);
    setTimeout(rodar, 120);
    setTimeout(rodar, 400);
}

function obterUltimos7DiasLabelsISO() {
    const labels = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        labels.push(d.toISOString().slice(0, 10));
    }
    return labels;
}

function formatarLabelsPt(labelsISO) {
    return labelsISO.map((d) => {
        const dt = new Date(d + 'T12:00:00');
        return dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    });
}

function contarApontamentosPorData(rows, labelsISO) {
    const map = Object.fromEntries(labelsISO.map((l) => [l, 0]));
    (rows || []).forEach((r) => {
        const k = (r.data_servico || '').slice(0, 10);
        if (k in map) map[k]++;
    });
    return labelsISO.map((l) => map[l]);
}

function preencherResumoApontamentos7d(containerId, labelsDisplay, counts) {
    const box = document.getElementById(containerId);
    if (!box) return;
    const maxVal = Math.max(...counts, 0);
    const soma = counts.reduce((a, b) => a + b, 0);
    const escala = Math.max(maxVal, 1);
    if (soma === 0) {
        box.classList.add('apt-bars-chart-root--empty');
        box.innerHTML = '<p class="apt-bars-chart-empty">Sem apontamentos neste período.</p>';
        box.removeAttribute('role');
        return;
    }
    box.classList.remove('apt-bars-chart-root--empty');
    box.setAttribute('role', 'img');
    const resumo = counts.map((c, i) => `${labelsDisplay[i]}: ${c}`).join('; ');
    box.setAttribute('aria-label', `Apontamentos nos últimos 7 dias. ${resumo}`);
    const cols = labelsDisplay
        .map((lb, i) => {
            const n = counts[i];
            const pct = Math.round((n / escala) * 100);
            const texto = String(lb).replace(/</g, '&lt;');
            const on = n > 0 ? ' apt-bars-chart__bar--on' : '';
            const vz = n === 0 ? ' apt-bars-chart__value--zero' : '';
            return `<div class="apt-bars-chart__col">
                <span class="apt-bars-chart__value${vz}">${n}</span>
                <div class="apt-bars-chart__track" aria-hidden="true">
                    <div class="apt-bars-chart__bar${on}" style="height:${pct}%"></div>
                </div>
                <span class="apt-bars-chart__label">${texto}</span>
            </div>`;
        })
        .join('');
    box.innerHTML = `<div class="apt-bars-chart">${cols}</div>`;
}

async function preencherKpiManutencao(uid) {
    const hoje = new Date().toISOString().slice(0, 10);
    const { data: prog } = await supabase
        .from('programacoes')
        .select('id')
        .eq('id_colaborador', uid)
        .eq('data_programada', hoje);

    const now = new Date();
    const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const filtroUid = filtroApontamentosPorUsuarioOuManutentor(uid);
    const { count: aptMes } = await supabase
        .from('apontamentos')
        .select('*', { count: 'exact', head: true })
        .or(filtroUid)
        .gte('data_servico', inicioMes);

    const { count: aptTotal } = await supabase
        .from('apontamentos')
        .select('*', { count: 'exact', head: true })
        .or(filtroUid);

    const setText = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v;
    };
    setText('dash-kpi-prog', String(prog?.length ?? 0));
    setText('dash-kpi-apt-mes', aptMes != null ? String(aptMes) : '—');
    setText('dash-kpi-apt-total', aptTotal != null ? String(aptTotal) : '—');
}

async function preencherKpiAdmin() {
    const { count: osAbertas } = await supabase
        .from('ordens_servico')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'aberta');

    const now = new Date();
    const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const { count: aptMes } = await supabase
        .from('apontamentos')
        .select('*', { count: 'exact', head: true })
        .gte('data_servico', inicioMes);

    const { count: osTotal } = await supabase
        .from('ordens_servico')
        .select('*', { count: 'exact', head: true });

    const { count: users } = await supabase
        .from('perfis')
        .select('*', { count: 'exact', head: true });

    const setText = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v;
    };
    setText('dash-kpi-os-abertas', osAbertas != null ? String(osAbertas) : '—');
    setText('dash-kpi-admin-apt', aptMes != null ? String(aptMes) : '—');
    setText('dash-kpi-os-total', osTotal != null ? String(osTotal) : '—');
    setText('dash-kpi-usuarios', users != null ? String(users) : '—');
}

async function renderizarChartsManutencao(uid) {
    const labelsISO = obterUltimos7DiasLabelsISO();
    const labelDisplay = formatarLabelsPt(labelsISO);
    const desde = labelsISO[0];

    const filtroUid = filtroApontamentosPorUsuarioOuManutentor(uid);
    const { data: apts } = await supabase
        .from('apontamentos')
        .select('data_servico')
        .or(filtroUid)
        .gte('data_servico', desde);

    const counts = contarApontamentosPorData(apts, labelsISO);
    preencherResumoApontamentos7d('dash-apontamentos-7d-simples', labelDisplay, counts);

    const now = new Date();
    const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const { data: mApts } = await supabase
        .from('apontamentos')
        .select('concluido')
        .or(filtroUid)
        .gte('data_servico', inicioMes);

    let conc = 0;
    let pend = 0;
    (mApts || []).forEach((a) => {
        if (a.concluido) conc++;
        else pend++;
    });

    destruirChartCanvas('chart-status-mes');
    const ctx2 = document.getElementById('chart-status-mes');
    if (ctx2 && typeof Chart !== 'undefined') {
        new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: ['Finalizados', 'Em aberto'],
                datasets: [
                    {
                        data: [conc, pend],
                        backgroundColor: ['#0d9488', '#bfdbfe'],
                        hoverOffset: 6,
                        borderWidth: 0
                    }
                ]
            },
            options: obterOpcoesGraficoRoscaDashboard()
        });
    }

    redimensionarChartsDashboardAtrasado();
}

async function renderizarChartsAdmin() {
    const labelsISO = obterUltimos7DiasLabelsISO();
    const labelDisplay = formatarLabelsPt(labelsISO);
    const desde = labelsISO[0];

    const { data: apts } = await supabase
        .from('apontamentos')
        .select('data_servico')
        .gte('data_servico', desde);

    const counts = contarApontamentosPorData(apts, labelsISO);
    preencherResumoApontamentos7d('dash-admin-apontamentos-7d-simples', labelDisplay, counts);

    const { data: ordens } = await supabase.from('ordens_servico').select('status');
    const statusMap = {};
    (ordens || []).forEach((o) => {
        const s = o.status || '—';
        statusMap[s] = (statusMap[s] || 0) + 1;
    });
    const keys = Object.keys(statusMap);
    const vals = keys.map((k) => statusMap[k]);
    const palette = ['#004175', '#1e6fa3', '#4a8eb8', '#7dd3fc', '#bae6fd', '#cbd5e1'];

    destruirChartCanvas('chart-admin-os-status');
    const ctx2 = document.getElementById('chart-admin-os-status');
    if (ctx2 && typeof Chart !== 'undefined') {
        const nCat = keys.length || 1;
        new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: keys.length ? keys : ['Sem dados'],
                datasets: [
                    {
                        data: keys.length ? vals : [1],
                        backgroundColor: keys.length
                            ? keys.map((_, i) => palette[i % palette.length])
                            : ['#e2e8f0'],
                        borderWidth: 0
                    }
                ]
            },
            options: obterOpcoesGraficoRoscaDashboardAdmin(nCat)
        });
    }

    redimensionarChartsDashboardAtrasado();
}

async function carregarDashboardInicio() {
    if (!estado.usuario) return;
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js não disponível.');
        return;
    }

    const uid = estado.usuario.id;
    const isAdmin = estado.perfil?.funcao === 'admin';
    const nome = estado.perfil?.nome_completo || '';
    const primeiroNome = nome.split(/\s+/).filter(Boolean)[0] || '—';

    const nomeEl = document.getElementById('dash-nome-usuario');
    const dataEl = document.getElementById('dash-data-extenso');
    if (nomeEl) nomeEl.textContent = primeiroNome;
    if (dataEl) {
        const agora = new Date();
        const dataTxt = agora.toLocaleDateString('pt-BR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
        const horaTxt = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        dataEl.textContent = `${dataTxt} · ${horaTxt}`;
    }

    document.getElementById('dashboard-kpi-manutencao')?.classList.toggle('oculto', isAdmin);
    document.getElementById('dashboard-kpi-admin')?.classList.toggle('oculto', !isAdmin);
    document.getElementById('dashboard-charts-manutencao')?.classList.toggle('oculto', isAdmin);
    document.getElementById('dashboard-charts-admin')?.classList.toggle('oculto', !isAdmin);

    if (isAdmin) {
        await preencherKpiAdmin();
        await renderizarChartsAdmin();
    } else {
        await preencherKpiManutencao(uid);
        await renderizarChartsManutencao(uid);
    }
    if (!window.__holambraDashboardResize) {
        window.__holambraDashboardResize = true;
        let rt;
        window.addEventListener('resize', () => {
            clearTimeout(rt);
            rt = setTimeout(() => redimensionarChartsDashboardAtrasado(), 200);
        });
        window.addEventListener('orientationchange', () => {
            setTimeout(() => redimensionarChartsDashboardAtrasado(), 350);
        });
    }
    lucide.createIcons();
}

async function carregarDashboardOperacao() {
    if (!estado.usuario || typeof Chart === 'undefined') return;

    const uid = estado.usuario.id;
    const nome = estado.perfil?.nome_completo || '';
    const primeiroNome = nome.split(/\s+/).filter(Boolean)[0] || '—';
    const el = document.getElementById('dash-op-nome');
    if (el) el.textContent = primeiroNome;

    const dataOpEl = document.getElementById('dash-op-datetime');
    if (dataOpEl) {
        const agora = new Date();
        const dataTxt = agora.toLocaleDateString('pt-BR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
        const horaTxt = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        dataOpEl.textContent = `${dataTxt} · ${horaTxt}`;
    }

    const { data: todas, error } = await supabase
        .from('ordens_servico')
        .select('status')
        .eq('id_solicitante', uid);

    const setText = (id, v) => {
        const e = document.getElementById(id);
        if (e) e.textContent = v;
    };

    if (error) {
        setText('dash-op-total', '—');
        setText('dash-op-abertas', '—');
        const bErr = document.getElementById('dash-op-status-simples');
        if (bErr) bErr.innerHTML = '<p class="dash-op-status-vazio">Não foi possível carregar o resumo.</p>';
        lucide.createIcons();
        return;
    }

    const list = todas || [];
    const abertas = list.filter((o) => o.status === 'aberta').length;
    setText('dash-op-total', String(list.length));
    setText('dash-op-abertas', String(abertas));

    const statusCount = {};
    list.forEach((o) => {
        const s = o.status || '—';
        statusCount[s] = (statusCount[s] || 0) + 1;
    });
    const keys = Object.keys(statusCount);
    const vals = keys.map((k) => statusCount[k]);
    const labelStatusOp = { aberta: 'Aberta', programada: 'Programada', em_andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
    const coresOp = ['#004175', '#1e6fa3', '#4a8eb8', '#7dd3fc', '#bae6fd', '#94a3b8'];

    const boxOp = document.getElementById('dash-op-status-simples');
    if (boxOp) {
        if (!keys.length) {
            boxOp.innerHTML = '<p class="dash-op-status-vazio">Sem solicitações para exibir.</p>';
        } else {
            const totalSt = vals.reduce((a, b) => a + b, 0) || 1;
            boxOp.innerHTML = keys.map((k, i) => {
                const n = statusCount[k];
                const pct = Math.max(6, Math.round((n / totalSt) * 100));
                const nome = labelStatusOp[k] || k;
                return `<div class="dash-op-status-linha">
                    <div class="dash-op-status-top"><span>${String(nome).replace(/</g, '&lt;')}</span><strong>${n}</strong></div>
                    <div class="dash-op-status-barra-wrap" role="presentation"><div class="dash-op-status-barra" style="width:${pct}%;background:${coresOp[i % coresOp.length]}"></div></div>
                </div>`;
            }).join('');
        }
    }
    lucide.createIcons();
}

verificarUsuario();
