const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

const {
  lerCSVConteudo,
  lerBaseSESTArquivo,
  normalizarBaseSEST,
  normalizarRegistrosREP
} = require('../src/services/sestCsvService');
const { mesclarBaseComREPs } = require('../src/services/sestMergeService');
const { normalizarTextoDjango } = require('../src/services/sestDatabaseService');

test('localiza a aba cadastral e o cabeçalho real da planilha semanal', async () => {
  const workbook = XLSX.utils.book_new();
  const resumo = XLSX.utils.aoa_to_sheet([
    ['GESTOR', 'NOME_SETOR', 'Contagem de NOME'],
    ['GESTOR A', 'Setor A', 1]
  ]);
  const lista = XLSX.utils.aoa_to_sheet([
    ['LISTA SEMANAL'],
    ['PERIODO'],
    ['CHAPA', 'NOME', 'COD_SETOR', 'NOME_SETOR', 'GESTOR', 'FUNCAO', 'SITUACAO'],
    ['3000001', 'ALICE', '03.01', 'Costura Fábrica 1-A', 'GESTOR A', 'OPERADORA', 'Ativo']
  ]);
  XLSX.utils.book_append_sheet(workbook, resumo, 'RESUMO');
  XLSX.utils.book_append_sheet(workbook, lista, 'LISTA DASS 25-08');

  const caminho = path.join(os.tmpdir(), 'nexus-sest-base-teste.xlsx');
  XLSX.writeFile(workbook, caminho);

  try {
    const arquivo = await lerBaseSESTArquivo(caminho, 'LISTA DASS 25-08.xlsx');
    const base = normalizarBaseSEST(arquivo.linhas);

    assert.equal(arquivo.aba, 'LISTA DASS 25-08');
    assert.equal(arquivo.linhaCabecalho, 3);
    assert.equal(base[0].matricula, '3000001');
    assert.equal(base[0].setor_folha, '03.01');
    assert.equal(base[0].situacao, 'Ativo');
  } finally {
    await fs.unlink(caminho);
  }
});

test('normaliza a base cadastral no padrão do Sheets', async () => {
  const linhas = await lerCSVConteudo(
    'SETOR;NOME;GESTOR;TURNO;CHAPA;RFID;BARRAS\n' +
    'Benefícios;ALICE;GESTOR A;C;3000001;;\n' +
    'Costura;BRUNO;GESTOR B;A;3000002;;'
  );

  const base = normalizarBaseSEST(linhas);

  assert.equal(base.length, 2);
  assert.equal(base[0].matricula, '3000001');
  assert.equal(base[0].nome_setor, 'Benefícios');
  assert.equal(base[1].turno, 'A');
});

test('rejeita matrícula duplicada na base cadastral', async () => {
  const linhas = await lerCSVConteudo(
    'SETOR,NOME,GESTOR,TURNO,CHAPA\n' +
    'Setor A,A,G,A,1\n' +
    'Setor B,B,G,B,1'
  );

  assert.throws(
    () => normalizarBaseSEST(linhas),
    (erro) => erro.code === 'VALIDATION_ERROR' &&
      erro.details.some((item) => item.motivo === 'Matrícula duplicada')
  );
});

test('faz left join e preserva funcionário sem REP', async () => {
  const baseLinhas = await lerCSVConteudo(
    'SETOR;NOME;GESTOR;TURNO;CHAPA\n' +
    'Benefícios;ALICE;GESTOR A;C;1\n' +
    'Costura;BRUNO;GESTOR B;A;2'
  );
  const repLinhas = await lerCSVConteudo(
    'matricula;rfid;barras\n' +
    '1;123;456\n' +
    '99;999;999'
  );

  const base = normalizarBaseSEST(baseLinhas);
  const rep = normalizarRegistrosREP(repLinhas, 'rep1');
  const resultado = mesclarBaseComREPs(base, rep.registros);

  assert.equal(resultado.totalBase, 2);
  assert.equal(resultado.totalComREP, 1);
  assert.equal(resultado.totalSemREP, 1);
  assert.equal(resultado.registros[0].rfid, '123');
  assert.equal(resultado.registros[1].rfid, null);
  assert.equal(resultado.registrosSemBase.length, 1);
});

test('resolve matrícula composta do REP pelo sufixo da CHAPA', async () => {
  const baseLinhas = await lerCSVConteudo(
    'SETOR;NOME;GESTOR;CHAPA\n' +
    'Costura;ALICE;GESTOR A;3000001\n' +
    'Costura;BRUNO;GESTOR B;3000002'
  );
  const repLinhas = await lerCSVConteudo(
    'matricula;rfid;barras;nome\n' +
    '113003000001;123;456;ALICE\n' +
    '0;789;999;BRUNO'
  );

  const base = normalizarBaseSEST(baseLinhas);
  const rep = normalizarRegistrosREP(repLinhas, 'rep1');
  const resultado = mesclarBaseComREPs(base, rep.registros);

  assert.equal(resultado.totalComREP, 2);
  assert.equal(resultado.totalSemREP, 0);
  assert.equal(resultado.registrosSemBase.length, 0);
  assert.equal(resultado.metodosREP.sufixo_matricula, 1);
  assert.equal(resultado.metodosREP.nome_unico, 1);
});

test('prioriza matrícula válida e audita o registro encontrado apenas por nome', async () => {
  const baseLinhas = await lerCSVConteudo(
    'SETOR;NOME;GESTOR;CHAPA\n' +
    'Costura;ALICE;GESTOR A;3000001'
  );
  const repLinhas = await lerCSVConteudo(
    'matricula;rfid;barras;nome\n' +
    '113003000001;123;456;ALICE\n' +
    '113009999999;999;888;ALICE'
  );

  const base = normalizarBaseSEST(baseLinhas);
  const rep = normalizarRegistrosREP(repLinhas, 'rep1');
  const resultado = mesclarBaseComREPs(base, rep.registros);

  assert.equal(resultado.conflitos.length, 0);
  assert.equal(resultado.alertas.length, 2);
  assert.equal(resultado.registros[0].rfid, '123');
  assert.equal(resultado.registros[0].codbarras, '456');
  assert.equal(resultado.alertas[0].metodoEscolhido, 'sufixo_matricula');
  assert.equal(resultado.alertas[0].metodoIgnorado, 'nome_unico');
});

test('bloqueia divergência entre registros com a mesma confiança', async () => {
  const baseLinhas = await lerCSVConteudo(
    'SETOR;NOME;GESTOR;CHAPA\n' +
    'Costura;ALICE;GESTOR A;1'
  );
  const repLinhas = await lerCSVConteudo(
    'matricula;rfid;barras;nome\n' +
    '113000000001;123;456;ALICE\n' +
    '223000000001;789;999;ALICE'
  );

  const base = normalizarBaseSEST(baseLinhas);
  const rep = normalizarRegistrosREP(repLinhas, 'rep1');
  const resultado = mesclarBaseComREPs(base, rep.registros);

  assert.equal(resultado.conflitos.length, 2);
  assert.equal(resultado.alertas.length, 0);
  assert.ok(resultado.conflitos.every((item) => item.motivo.includes('mesma confiança')));
});

test('usa BARRAS da base somente como correspondência de apoio', async () => {
  const baseLinhas = await lerCSVConteudo(
    'SETOR;NOME;GESTOR;CHAPA;BARRAS\n' +
    'Costura;ALICE;GESTOR A;1;456'
  );
  const repLinhas = await lerCSVConteudo(
    'matricula;rfid;barras;nome\n' +
    ';123;456;ALICE'
  );

  const base = normalizarBaseSEST(baseLinhas);
  const rep = normalizarRegistrosREP(repLinhas, 'rep1');
  const resultado = mesclarBaseComREPs(base, rep.registros);

  assert.equal(resultado.conflitos.length, 0);
  assert.equal(resultado.totalComREP, 1);
  assert.equal(resultado.metodosREP.barras_base, 1);
  assert.equal(resultado.registros[0].rfid, '123');
});

test('mantém a normalização textual consolidada no Django para o banco', () => {
  assert.equal(
    normalizarTextoDjango('Benefícios - Fábrica/1'),
    'Beneficios Fabrica 1'
  );
});
