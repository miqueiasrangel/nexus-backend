const fs = require('fs/promises');

const {
  lerBaseSESTArquivo,
  lerCSVConteudo,
  normalizarBaseSEST,
  normalizarRegistrosREP
} = require('../services/sestCsvService');
const { coletarREPs } = require('../services/repService');
const { mesclarBaseComREPs } = require('../services/sestMergeService');
const { sincronizarBancoSEST } = require('../services/sestDatabaseService');
const { sincronizarPlanilhaSEST } = require('../services/googleSheetsService');

async function removerArquivo(caminho) {
  if (!caminho) return;
  try {
    await fs.unlink(caminho);
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      console.error('Não foi possível remover arquivo temporário:', erro.message);
    }
  }
}

function responderErro(res, erro) {
  if (erro.code === 'VALIDATION_ERROR') {
    return res.status(422).json({
      status: 'falhou',
      erro: erro.message,
      detalhes: erro.details || []
    });
  }

  if (
    erro.code === 'REP_CONFIG_ERROR' ||
    erro.code === 'REP_COLLECTION_ERROR' ||
    erro.code === 'REP_LOGIN_ERROR' ||
    erro.code === 'REP_EXPORT_ERROR' ||
    erro.code === 'REP_LOGIN_RESPONSE_ERROR' ||
    erro.code === 'REP_SESSION_ERROR' ||
    erro.code === 'REP_EMPTY_EXPORT'
  ) {
    console.error('Falha na coleta dos REPs:', erro.details || erro.message);
    return res.status(502).json({
      status: 'falhou',
      erro: erro.message,
      detalhes: erro.details || []
    });
  }

  console.error('Erro na sincronização SEST:', erro);
  return res.status(500).json({
    status: 'falhou',
    erro: 'Erro interno na sincronização SEST.',
    detalhes: erro.message
  });
}

function resumirSituacoes(base) {
  const contagem = {};

  for (const funcionario of base) {
    const situacao = funcionario.situacao || 'SEM_SITUACAO';
    contagem[situacao] = (contagem[situacao] || 0) + 1;
  }

  return contagem;
}

async function sincronizarSEST(req, res) {
  let caminhoBase;

  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'falhou',
        erro: 'A base cadastral Excel ou CSV é obrigatória.'
      });
    }

    caminhoBase = req.file.path;
    const arquivoBase = await lerBaseSESTArquivo(
      caminhoBase,
      req.file.originalname
    );
    const base = normalizarBaseSEST(arquivoBase.linhas);

    const exportacoes = await coletarREPs();
    const registrosREP = [];
    const errosREP = [];
    const resumoREPs = [];

    for (const exportacao of exportacoes) {
      const linhas = await lerCSVConteudo(exportacao.content);
      const resultado = normalizarRegistrosREP(linhas, exportacao.id);
      registrosREP.push(...resultado.registros);
      errosREP.push(...resultado.erros);
      resumoREPs.push({
        dispositivo: exportacao.id,
        bytes: exportacao.bytes,
        registros: resultado.registros.length,
        linhasInvalidas: resultado.erros.length
      });
    }

    if (registrosREP.length === 0) {
      const erro = new Error('Os REPs não retornaram registros utilizáveis.');
      erro.code = 'VALIDATION_ERROR';
      erro.details = errosREP;
      throw erro;
    }

    const cruzamento = mesclarBaseComREPs(base, registrosREP);

    if (cruzamento.conflitos.length > 0) {
      const erro = new Error('Existem conflitos entre os dados dos REPs.');
      erro.code = 'VALIDATION_ERROR';
      erro.details = cruzamento.conflitos;
      throw erro;
    }

    const simulacao = String(req.body && req.body.dryRun).toLowerCase() === 'true';
    const respostaBase = {
      status: simulacao ? 'simulacao' : 'iniciada',
      base: {
        arquivo: arquivoBase.nomeArquivo,
        origem: arquivoBase.origem,
        aba: arquivoBase.aba,
        linhaCabecalho: arquivoBase.linhaCabecalho,
        registros: base.length,
        situacoes: resumirSituacoes(base)
      },
      cruzamento: {
        totalBase: cruzamento.totalBase,
        totalComREP: cruzamento.totalComREP,
        totalSemREP: cruzamento.totalSemREP,
        registrosSemBase: cruzamento.registrosSemBase.length,
        linhasREPInvalidas: errosREP.length,
        divergenciasResolvidas: cruzamento.alertas.length,
        metodosREP: cruzamento.metodosREP
      },
      reps: resumoREPs,
      inconsistencias: {
        registrosSemBase: cruzamento.registrosSemBase,
        linhasREPInvalidas: errosREP,
        divergenciasResolvidas: cruzamento.alertas
      }
    };

    if (simulacao) {
      return res.json({
        ...respostaBase,
        mensagem: 'Simulação concluída. Nenhum destino foi alterado.'
      });
    }

    const banco = await sincronizarBancoSEST(cruzamento.registros, {
      removerAusentes: process.env.SEST_REMOVE_MISSING === 'true'
    });

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_NAME;
    let planilha;
    let status = 'concluida';

    if (!spreadsheetId || !sheetName) {
      status = 'parcial';
      planilha = {
        status: 'nao_configurada',
        aviso: 'Google Sheets não configurado no ambiente.'
      };
    } else {
      try {
        planilha = await sincronizarPlanilhaSEST(
          spreadsheetId,
          sheetName,
          cruzamento.registros,
          {
            removerAusentes: process.env.SEST_SHEET_REMOVE_MISSING === 'true'
          }
        );
      } catch (erroPlanilha) {
        status = 'parcial';
        console.error('Erro ao sincronizar Google Sheets:', erroPlanilha.message);
        planilha = {
          status: 'pendente',
          erro: erroPlanilha.message
        };
      }
    }

    return res.json({
      ...respostaBase,
      status,
      mensagem: status === 'concluida'
        ? cruzamento.alertas.length > 0
          ? 'Sincronização SEST concluída com avisos de reconciliação automática.'
          : 'Sincronização SEST concluída com sucesso.'
        : 'Banco atualizado, mas existem destinos pendentes.',
      banco,
      planilha
    });
  } catch (erro) {
    return responderErro(res, erro);
  } finally {
    await removerArquivo(caminhoBase);
  }
}

module.exports = {
  sincronizarSEST
};
