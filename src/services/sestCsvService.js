const fs = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const csv = require('csv-parser');
const xlsx = require('xlsx');

function removerAcentos(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizarCabecalho(valor) {
  return removerAcentos(valor)
    .replace(/^\uFEFF/, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizarTexto(valor) {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).replace(/^\uFEFF/, '').trim();
  return texto === '' ? null : texto;
}

function normalizarIdentificador(valor, removerZerosIniciais = false) {
  const texto = normalizarTexto(valor);
  if (!texto) return null;

  let limpo = texto.replace(/\s/g, '');
  if (/^\d+\.0+$/.test(limpo)) {
    limpo = limpo.split('.')[0];
  }

  if (!/^\d+$/.test(limpo)) return null;
  if (removerZerosIniciais) {
    limpo = limpo.replace(/^0+(?=\d)/, '');
  }

  return limpo;
}

function normalizarIdentificadorREP(valor, removerZerosIniciais = false) {
  const identificador = normalizarIdentificador(valor, removerZerosIniciais);
  return identificador && !/^0+$/.test(identificador)
    ? identificador
    : null;
}

function detectarSeparador(conteudo) {
  const primeiraLinha = String(conteudo)
    .split(/\r?\n/)
    .find((linha) => linha.trim().length > 0) || '';

  const quantidadePontoEVirgula = (primeiraLinha.match(/;/g) || []).length;
  const quantidadeVirgulas = (primeiraLinha.match(/,/g) || []).length;

  if (quantidadePontoEVirgula > 0 && quantidadePontoEVirgula >= quantidadeVirgulas) {
    return ';';
  }

  return ',';
}

function lerCSVConteudo(conteudo) {
  const texto = Buffer.isBuffer(conteudo)
    ? conteudo.toString('utf8')
    : String(conteudo || '');
  const separador = detectarSeparador(texto);

  return new Promise((resolve, reject) => {
    const resultados = [];
    const stream = Readable.from([texto]);

    stream
      .pipe(csv({
        separator: separador,
        mapHeaders: ({ header }) => normalizarCabecalho(header)
      }))
      .on('data', (linha) => resultados.push(linha))
      .on('end', () => resolve(resultados))
      .on('error', reject);
  });
}

async function lerCSVArquivo(caminhoArquivo) {
  const conteudo = await fs.readFile(caminhoArquivo);
  return lerCSVConteudo(conteudo);
}

function erroDeArquivoBase(mensagem, detalhes) {
  const erro = new Error(mensagem);
  erro.code = 'VALIDATION_ERROR';
  erro.details = detalhes;
  return erro;
}

function linhaParaObjeto(cabecalho, linha) {
  const objeto = {};

  cabecalho.forEach((valor, indice) => {
    const chave = normalizarCabecalho(valor);
    if (chave && !Object.prototype.hasOwnProperty.call(objeto, chave)) {
      objeto[chave] = linha[indice] === undefined ? null : linha[indice];
    }
  });

  return objeto;
}

function localizarCabecalhoBaseSEST(workbook) {
  const candidatos = [];

  for (const nomeAba of workbook.SheetNames) {
    const sheet = workbook.Sheets[nomeAba];
    const linhas = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: false
    });

    const limite = Math.min(linhas.length, 50);
    for (let indice = 0; indice < limite; indice += 1) {
      const cabecalho = (linhas[indice] || []).map((valor) =>
        normalizarCabecalho(valor)
      );
      const conjunto = new Set(cabecalho.filter(Boolean));
      const possuiMatricula = conjunto.has('CHAPA') ||
        conjunto.has('MATRICULA');
      const possuiNome = conjunto.has('NOME') ||
        conjunto.has('NOME_COLABORADOR') ||
        conjunto.has('FUNCIONARIO');
      const possuiGerente = conjunto.has('GESTOR') ||
        conjunto.has('GERENTE');
      const possuiSetor = conjunto.has('SETOR') ||
        conjunto.has('NOME_SETOR') ||
        conjunto.has('DEPARTAMENTO');

      if (!possuiMatricula || !possuiNome || !possuiGerente || !possuiSetor) {
        continue;
      }

      let pontuacao = 0;
      if (conjunto.has('COD_SETOR')) pontuacao += 3;
      if (conjunto.has('NOME_SETOR')) pontuacao += 3;
      if (conjunto.has('FUNCAO')) pontuacao += 2;
      if (conjunto.has('SITUACAO')) pontuacao += 1;
      if (nomeAba.toUpperCase().includes('LISTA')) pontuacao += 1;

      candidatos.push({
        nomeAba,
        indiceCabecalho: indice,
        linhas,
        cabecalho,
        pontuacao
      });
    }
  }

  candidatos.sort((a, b) => b.pontuacao - a.pontuacao);
  return candidatos[0] || null;
}

async function lerXLSXArquivo(caminhoArquivo) {
  let workbook;

  try {
    workbook = xlsx.readFile(caminhoArquivo, {
      cellDates: true,
      raw: false
    });
  } catch (erro) {
    throw erroDeArquivoBase(
      'Não foi possível ler a planilha Excel enviada.',
      [{ motivo: erro.message }]
    );
  }

  const origem = localizarCabecalhoBaseSEST(workbook);
  if (!origem) {
    throw erroDeArquivoBase(
      'Não foi encontrada uma aba da base cadastral SEST no Excel.',
      [{
        motivo: 'A planilha precisa possuir CHAPA, NOME, GESTOR e SETOR/NOME_SETOR.',
        abas: workbook.SheetNames
      }]
    );
  }

  const linhas = origem.linhas
    .slice(origem.indiceCabecalho + 1)
    .map((linha) => linhaParaObjeto(origem.cabecalho, linha));

  return {
    linhas,
    origem: 'xlsx',
    aba: origem.nomeAba,
    linhaCabecalho: origem.indiceCabecalho + 1,
    nomeArquivo: path.basename(caminhoArquivo)
  };
}

async function lerBaseSESTArquivo(caminhoArquivo, nomeOriginal) {
  const extensao = path.extname(nomeOriginal || caminhoArquivo).toLowerCase();

  if (['.xlsx', '.xls', '.xlsm'].includes(extensao)) {
    const resultado = await lerXLSXArquivo(caminhoArquivo);
    return {
      ...resultado,
      nomeArquivo: nomeOriginal || resultado.nomeArquivo
    };
  }

  return {
    linhas: await lerCSVArquivo(caminhoArquivo),
    origem: 'csv',
    aba: null,
    linhaCabecalho: 1,
    nomeArquivo: nomeOriginal || path.basename(caminhoArquivo)
  };
}

function obterValor(linha, aliases) {
  for (const alias of aliases) {
    const chave = normalizarCabecalho(alias);
    if (Object.prototype.hasOwnProperty.call(linha, chave)) {
      return normalizarTexto(linha[chave]);
    }
  }
  return null;
}

function criarErroValidacao(mensagem, detalhes) {
  const erro = new Error(mensagem);
  erro.code = 'VALIDATION_ERROR';
  erro.details = detalhes;
  return erro;
}

function linhaVazia(linha) {
  return Object.values(linha).every((valor) => normalizarTexto(valor) === null);
}

function normalizarBaseSEST(linhas) {
  const registros = [];
  const erros = [];
  const matriculas = new Map();

  linhas.forEach((linha, indice) => {
    const numeroLinha = indice + 2;
    if (linhaVazia(linha)) return;

    const matricula = normalizarIdentificador(
      obterValor(linha, ['CHAPA', 'MATRICULA', 'MATRÍCULA', 'MAT']),
      true
    );
    const nome = obterValor(linha, ['NOME', 'NOME_COLABORADOR', 'FUNCIONARIO']);
    const setor = obterValor(linha, ['NOME_SETOR', 'SETOR', 'DEPARTAMENTO']);
    const gerente = obterValor(linha, ['GESTOR', 'GERENTE']);

    if (!matricula) erros.push({ linha: numeroLinha, campo: 'CHAPA', motivo: 'Matrícula inválida ou vazia' });
    if (!nome) erros.push({ linha: numeroLinha, campo: 'NOME', motivo: 'Nome vazio' });
    if (!setor) erros.push({ linha: numeroLinha, campo: 'SETOR/NOME_SETOR', motivo: 'Setor vazio' });
    if (!gerente) erros.push({ linha: numeroLinha, campo: 'GESTOR', motivo: 'Gestor vazio' });

    if (matricula && matriculas.has(matricula)) {
      erros.push({
        linha: numeroLinha,
        campo: 'CHAPA',
        motivo: 'Matrícula duplicada',
        valor: matricula,
        linhaAnterior: matriculas.get(matricula)
      });
    } else if (matricula) {
      matriculas.set(matricula, numeroLinha);
    }

    if (!matricula || !nome || !setor || !gerente) return;

    registros.push({
      matricula,
      nome,
      setor,
      nome_setor: obterValor(linha, ['NOME_SETOR']) || setor,
      setor_folha: obterValor(linha, ['COD_SETOR', 'SETOR_FOLHA', 'CODIGO_SETOR']),
      gerente,
      funcao: obterValor(linha, ['FUNCAO', 'FUNÇÃO']),
      turno: obterValor(linha, ['TURNO']),
      situacao: obterValor(linha, ['SITUACAO', 'SITUAÇÃO', 'STATUS']),
      nome_exibicao: nome,
      setor_exibicao: setor,
      gerente_exibicao: gerente,
      rfid: normalizarIdentificador(obterValor(linha, ['RFID', 'TAG', 'CARTAO'])),
      codbarras: normalizarIdentificador(obterValor(linha, [
        'BARRAS',
        'CODIGO_BARRAS',
        'CODIGO_BARRA',
        'COD_BARRAS',
        'CRACHA_CRIPT_ERP',
        'CRACHA'
      ]))
    });
  });

  if (erros.length > 0) {
    throw criarErroValidacao('A base cadastral possui erros de validação.', erros);
  }

  if (registros.length === 0) {
    throw criarErroValidacao('A base cadastral não possui registros válidos.', []);
  }

  return registros;
}

function normalizarRegistrosREP(linhas, origem) {
  const registros = [];
  const erros = [];

  linhas.forEach((linha, indice) => {
    const numeroLinha = indice + 2;
    if (linhaVazia(linha)) return;

    const matricula = normalizarIdentificadorREP(
      obterValor(linha, ['MATRICULA', 'MATRÍCULA', 'CHAPA', 'MAT']),
      true
    );
    const rfid = normalizarIdentificadorREP(obterValor(linha, [
      'RFID',
      'TAG',
      'CARTAO',
      'CARTÃO'
    ]));
    const codbarras = normalizarIdentificadorREP(obterValor(linha, [
      'BARRAS',
      'CODIGO',
      'CODIGO_BARRAS',
      'CODIGO_BARRA',
      'COD_BARRAS',
      'CRACHA_CRIPT_ERP',
      'CRACHA'
    ]));

    if (!matricula && !codbarras) {
      erros.push({
        origem,
        linha: numeroLinha,
        motivo: 'Registro sem matrícula e sem BARRAS'
      });
      return;
    }

    registros.push({
      origem,
      linha: numeroLinha,
      matricula,
      matricula_rep: matricula,
      nome: obterValor(linha, ['NOME', 'NOME_COLABORADOR', 'FUNCIONARIO']),
      rfid,
      codbarras
    });
  });

  return { registros, erros };
}

module.exports = {
  lerCSVConteudo,
  lerCSVArquivo,
  lerXLSXArquivo,
  lerBaseSESTArquivo,
  normalizarBaseSEST,
  normalizarRegistrosREP,
  normalizarCabecalho,
  normalizarIdentificador,
  normalizarIdentificadorREP,
  normalizarTexto
};
