const pool = require('../database/connection');

const STAGE_COLUMNS = [
  'matricula',
  'nome',
  'setor_folha',
  'nome_setor',
  'gerente',
  'funcao',
  'rfid',
  'codbarras',
  'rep_found'
];

const COLUNAS_OBRIGATORIAS = {
  lista_funcionario: [
    'matricula',
    'nome',
    'setor_folha',
    'nome_setor',
    'gerente',
    'funcao',
    'data_att',
    'hora_att'
  ],
  colaboradores: [
    'rfid',
    'matricula',
    'nome',
    'usuarioupdate',
    'updatedate',
    'codbarras',
    'unidade_dass'
  ]
};

function removerAcentos(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function adicionarFabricaQuandoNecessario(valor) {
  const texto = String(valor || '');
  const semAcentos = removerAcentos(texto);

  if (semAcentos.toLowerCase().includes('fabrica')) {
    return texto;
  }

  const termos = [
    { termo: 'Frequencia', insercao: 'Fabrica' },
    { termo: 'Costura', insercao: 'Fabrica' }
  ];

  for (const item of termos) {
    const indice = semAcentos.indexOf(item.termo);
    if (indice >= 0) {
      const fimTermo = indice + item.termo.length;
      return texto.slice(0, fimTermo) + ' ' + item.insercao + texto.slice(fimTermo);
    }
  }

  return texto;
}

function normalizarTextoDjango(valor, opcoes = {}) {
  if (valor === undefined || valor === null) return null;

  let texto = String(valor).trim();
  if (!texto) return null;

  if (opcoes.adicionarFabrica) {
    texto = adicionarFabricaQuandoNecessario(texto);
  }

  texto = removerAcentos(texto)
    .replace(/[./\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return texto || null;
}

function prepararRegistroParaBanco(registro) {
  return {
    ...registro,
    nome: normalizarTextoDjango(registro.nome),
    setor_folha: normalizarTextoDjango(registro.setor_folha),
    nome_setor: normalizarTextoDjango(
      registro.nome_setor || registro.setor,
      { adicionarFabrica: true }
    ),
    gerente: normalizarTextoDjango(registro.gerente),
    funcao: normalizarTextoDjango(registro.funcao)
  };
}

function erroDeSchema(mensagem, detalhes) {
  const erro = new Error(mensagem);
  erro.code = 'DATABASE_SCHEMA_ERROR';
  erro.details = detalhes;
  return erro;
}

async function validarSchemaSEST(client) {
  const resultadoColunas = await client.query(
    [
      'SELECT table_name, column_name',
      'FROM information_schema.columns',
      'WHERE table_schema = \'colaborador\'',
      '  AND table_name IN (\'lista_funcionario\', \'colaboradores\');'
    ].join('\n')
  );

  const colunasPorTabela = new Map();
  for (const linha of resultadoColunas.rows) {
    if (!colunasPorTabela.has(linha.table_name)) {
      colunasPorTabela.set(linha.table_name, new Set());
    }
    colunasPorTabela.get(linha.table_name).add(linha.column_name);
  }

  const colunasAusentes = [];
  for (const [tabela, colunas] of Object.entries(COLUNAS_OBRIGATORIAS)) {
    const existentes = colunasPorTabela.get(tabela) || new Set();
    for (const coluna of colunas) {
      if (!existentes.has(coluna)) {
        colunasAusentes.push(tabela + '.' + coluna);
      }
    }
  }

  if (colunasAusentes.length > 0) {
    throw erroDeSchema(
      'O schema SEST não possui todas as colunas necessárias.',
      { colunasAusentes }
    );
  }

  const resultadoChaves = await client.query(
    [
      'SELECT tc.table_name, kcu.column_name, tc.constraint_type',
      'FROM information_schema.table_constraints AS tc',
      'JOIN information_schema.key_column_usage AS kcu',
      '  ON tc.constraint_name = kcu.constraint_name',
      ' AND tc.table_schema = kcu.table_schema',
      ' AND tc.table_name = kcu.table_name',
      'WHERE tc.table_schema = \'colaborador\'',
      '  AND tc.table_name IN (\'lista_funcionario\', \'colaboradores\')',
      '  AND tc.constraint_type IN (\'PRIMARY KEY\', \'UNIQUE\')',
      '  AND kcu.column_name = \'matricula\';'
    ].join('\n')
  );

  const tabelasComChave = new Set(
    resultadoChaves.rows.map((linha) => linha.table_name)
  );
  const tabelasSemChave = ['lista_funcionario', 'colaboradores']
    .filter((tabela) => !tabelasComChave.has(tabela));

  if (tabelasSemChave.length > 0) {
    throw erroDeSchema(
      'As tabelas SEST precisam de chave única por matrícula antes da sincronização.',
      { tabelasSemChave }
    );
  }
}

function dividirEmLotes(registros, tamanho) {
  const lotes = [];
  for (let indice = 0; indice < registros.length; indice += tamanho) {
    lotes.push(registros.slice(indice, indice + tamanho));
  }
  return lotes;
}

async function carregarStaging(client, registros) {
  await client.query(
    [
      'CREATE TEMP TABLE sest_sync_stage (',
      '  matricula bigint PRIMARY KEY,',
      '  nome text NOT NULL,',
      '  setor_folha text,',
      '  nome_setor text,',
      '  gerente text NOT NULL,',
      '  funcao text,',
      '  rfid text,',
      '  codbarras text,',
      '  rep_found boolean NOT NULL',
      ') ON COMMIT DROP;'
    ].join('\n')
  );

  for (const lote of dividirEmLotes(registros, 500)) {
    const parametros = [];
    const valores = [];
    let indiceParametro = 1;

    for (const registroOriginal of lote) {
      const registro = prepararRegistroParaBanco(registroOriginal);
      const marcadores = STAGE_COLUMNS.map(() => '$' + indiceParametro++);
      valores.push('(' + marcadores.join(', ') + ')');
      parametros.push(
        registro.matricula,
        registro.nome,
        registro.setor_folha || null,
        registro.nome_setor || registro.setor || null,
        registro.gerente,
        registro.funcao || null,
        registro.rfid || null,
        registro.codbarras || null,
        Boolean(registro.rep_found)
      );
    }

    await client.query(
      'INSERT INTO sest_sync_stage (' +
        STAGE_COLUMNS.join(', ') +
        ') VALUES ' +
        valores.join(', '),
      parametros
    );
  }
}

async function obterExpressoesDataHora(client) {
  const resultado = await client.query(
    [
      'SELECT column_name, data_type, udt_name',
      'FROM information_schema.columns',
      'WHERE table_schema = \'colaborador\'',
      '  AND table_name = \'lista_funcionario\'',
      '  AND column_name IN (\'data_att\', \'hora_att\');'
    ].join('\n')
  );

  const tipos = new Map(
    resultado.rows.map((linha) => [linha.column_name, {
      dataType: String(linha.data_type || '').toLowerCase(),
      udtName: String(linha.udt_name || '').toLowerCase()
    }])
  );

  const tipoData = tipos.get('data_att') || {
    dataType: 'date',
    udtName: 'date'
  };
  const tipoHora = tipos.get('hora_att') || {
    dataType: 'time without time zone',
    udtName: 'time'
  };

  const dataExpression = tipoData.udtName === 'date' || tipoData.dataType === 'date'
    ? 'CURRENT_DATE'
    : tipoData.dataType.includes('timestamp') ||
      ['timestamp', 'timestamptz'].includes(tipoData.udtName)
      ? 'CURRENT_TIMESTAMP'
      : tipoData.dataType.includes('char') || tipoData.dataType.includes('text')
        ? 'CURRENT_DATE::text'
        : 'CURRENT_DATE';

  const horaExpression = tipoHora.udtName === 'timetz' ||
    tipoHora.dataType === 'time with time zone'
    ? 'CURRENT_TIME'
    : tipoHora.udtName === 'time' ||
      tipoHora.dataType === 'time without time zone'
      ? 'CURRENT_TIME::time'
      : tipoHora.dataType.includes('timestamp') ||
        ['timestamp', 'timestamptz'].includes(tipoHora.udtName)
        ? 'CURRENT_TIMESTAMP'
        : tipoHora.dataType.includes('char') || tipoHora.dataType.includes('text')
          ? 'to_char(CURRENT_TIMESTAMP, \'HH24:MI:SSOF\')'
          : 'CURRENT_TIME::text';

  return {
    data: dataExpression,
    hora: horaExpression
  };
}

async function atualizarListaFuncionario(client, removerAusentes, dataHora) {
  const atualizados = await client.query(
    [
      'UPDATE colaborador.lista_funcionario AS destino',
      'SET',
      '  nome = est.nome,',
      '  setor_folha = COALESCE(NULLIF(est.setor_folha, \'\'), destino.setor_folha),',
      '  nome_setor = COALESCE(NULLIF(est.nome_setor, \'\'), destino.nome_setor),',
      '  gerente = est.gerente,',
      '  funcao = COALESCE(NULLIF(est.funcao, \'\'), destino.funcao),',
      '  data_att = ' + dataHora.data + ',',
      '  hora_att = ' + dataHora.hora,
      'FROM sest_sync_stage AS est',
      'WHERE destino.matricula = est.matricula',
      '  AND (',
      '    destino.nome IS DISTINCT FROM est.nome',
      '    OR (NULLIF(est.setor_folha, \'\') IS NOT NULL AND destino.setor_folha IS DISTINCT FROM est.setor_folha)',
      '    OR (NULLIF(est.nome_setor, \'\') IS NOT NULL AND destino.nome_setor IS DISTINCT FROM est.nome_setor)',
      '    OR destino.gerente IS DISTINCT FROM est.gerente',
      '    OR (NULLIF(est.funcao, \'\') IS NOT NULL AND destino.funcao IS DISTINCT FROM est.funcao)',
      '  )',
      'RETURNING destino.matricula;'
    ].join('\n')
  );

  const inseridos = await client.query(
    [
      'INSERT INTO colaborador.lista_funcionario',
      '(matricula, nome, setor_folha, nome_setor, gerente, funcao, data_att, hora_att)',
      'SELECT',
      '  est.matricula,',
      '  est.nome,',
      '  NULLIF(est.setor_folha, \'\'),',
      '  NULLIF(est.nome_setor, \'\'),',
      '  est.gerente,',
      '  NULLIF(est.funcao, \'\'),',
      '  ' + dataHora.data + ',',
      '  ' + dataHora.hora,
      'FROM sest_sync_stage AS est',
      'WHERE NOT EXISTS (',
      '  SELECT 1',
      '  FROM colaborador.lista_funcionario AS destino',
      '  WHERE destino.matricula = est.matricula',
      ');'
    ].join('\n')
  );

  let removidos = 0;
  if (removerAusentes) {
    const resultado = await client.query(
      [
        'DELETE FROM colaborador.lista_funcionario AS destino',
        'WHERE NOT EXISTS (',
        '  SELECT 1',
        '  FROM sest_sync_stage AS est',
        '  WHERE est.matricula = destino.matricula',
        ');'
      ].join('\n')
    );
    removidos = resultado.rowCount;
  }

  return {
    inseridos: inseridos.rowCount,
    atualizados: atualizados.rowCount,
    removidos
  };
}

async function atualizarColaboradores(client) {
  const usuario = process.env.SEST_SYNC_USER || 'SISTEMA_NEXUS_SEST';

  const inseridos = await client.query(
    [
      'INSERT INTO colaborador.colaboradores',
      '(rfid, matricula, nome, usuarioupdate, updatedate, codbarras, unidade_dass)',
      'SELECT',
      '  NULLIF(est.rfid, \'\')::bigint,',
      '  est.matricula,',
      '  est.nome,',
      '  $1,',
      '  NOW(),',
      '  NULLIF(est.codbarras, \'\')::bigint,',
      '  \'SEST\'',
      'FROM sest_sync_stage AS est',
      'WHERE est.rep_found = TRUE',
      '  AND NOT EXISTS (',
      '    SELECT 1',
      '    FROM colaborador.colaboradores AS destino',
      '    WHERE destino.matricula = est.matricula',
      '  );'
    ].join('\n'),
    [usuario]
  );

  const atualizados = await client.query(
    [
      'UPDATE colaborador.colaboradores AS destino',
      'SET',
      '  rfid = COALESCE(NULLIF(est.rfid, \'\')::bigint, destino.rfid),',
      '  codbarras = COALESCE(NULLIF(est.codbarras, \'\')::bigint, destino.codbarras),',
      '  nome = COALESCE(NULLIF(est.nome, \'\'), destino.nome),',
      '  unidade_dass = \'SEST\',',
      '  usuarioupdate = $1,',
      '  updatedate = NOW()',
      'FROM sest_sync_stage AS est',
      'WHERE destino.matricula = est.matricula',
      '  AND est.rep_found = TRUE',
      '  AND (',
      '    (NULLIF(est.rfid, \'\') IS NOT NULL AND destino.rfid IS DISTINCT FROM NULLIF(est.rfid, \'\')::bigint)',
      '    OR (NULLIF(est.codbarras, \'\') IS NOT NULL AND destino.codbarras IS DISTINCT FROM NULLIF(est.codbarras, \'\')::bigint)',
      '    OR (NULLIF(est.nome, \'\') IS NOT NULL AND destino.nome IS DISTINCT FROM est.nome)',
      '    OR destino.unidade_dass IS DISTINCT FROM \'SEST\'',
      '  )',
      'RETURNING destino.matricula;'
    ].join('\n'),
    [usuario]
  );

  return {
    inseridos: inseridos.rowCount,
    atualizados: atualizados.rowCount
  };
}

async function sincronizarBancoSEST(registros, opcoes = {}) {
  if (!Array.isArray(registros) || registros.length === 0) {
    throw new Error('Não existem registros para sincronizar no PostgreSQL.');
  }

  const client = await pool.connect();

  try {
    await validarSchemaSEST(client);
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1));',
      ['nexus:sest:sincronizacao']
    );

    await carregarStaging(client, registros);
    const dataHora = await obterExpressoesDataHora(client);

    const lista = await atualizarListaFuncionario(
      client,
      Boolean(opcoes.removerAusentes),
      dataHora
    );
    const colaboradores = await atualizarColaboradores(client);

    await client.query('COMMIT');

    const totalREP = registros.filter((registro) => registro.rep_found).length;

    return {
      status: 'concluida',
      total: registros.length,
      lista_funcionario: {
        ...lista,
        ignorados: Math.max(
          0,
          registros.length - lista.inseridos - lista.atualizados
        ),
        total: registros.length
      },
      colaboradores: {
        ...colaboradores,
        ignorados: Math.max(
          0,
          totalREP - colaboradores.inseridos - colaboradores.atualizados
        ),
        total: totalREP
      }
    };
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}

module.exports = {
  sincronizarBancoSEST,
  validarSchemaSEST,
  normalizarTextoDjango
};
