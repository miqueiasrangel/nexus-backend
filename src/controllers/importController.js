const { lerCSV } = require('../services/csvService');
const { lerXLS } = require('../services/xlsService');
const { prepararMapaXLS, cruzarDados } = require('../services/mergeService');
const { inserirFuncionario } = require('../services/employeeService');
const { sincronizarPlanilha } = require('../services/googleSheetsService');

async function importarArquivos(req, res) {
  try {
    // VALIDAÇÃO DOS ARQUIVOS
    const filesCSV = [];
    if (req.files && req.files.csv) filesCSV.push(...req.files.csv);
    if (req.files && req.files.csv2) filesCSV.push(...req.files.csv2);

    if (filesCSV.length === 0 || !req.files || !req.files.xls) {
      return res.status(400).json({
        erro: 'Pelo menos 1 arquivo CSV/TXT e 1 arquivo XLS são obrigatórios'
      });
    }

    const xlsFile = req.files.xls[0];

    // LEITURA DE TODOS OS ARQUIVOS CSV/TXT DISPONÍVEIS
    let dadosCSV = [];
    for (const file of filesCSV) {
      const conteudo = await lerCSV(file.path);
      dadosCSV = dadosCSV.concat(conteudo);
    }

    const dadosXLS = await lerXLS(xlsFile.path);

    const mapaXLS = prepararMapaXLS(dadosXLS);
    const { registrosValidos } = cruzarDados(dadosCSV, mapaXLS);

    console.log("CSV:", dadosCSV.length);
    console.log("XLS:", dadosXLS.length);
    console.log("REGISTROS VÁLIDOS:", registrosValidos.length);
    console.log("🚀 Servidor rodando na porta 3333");

    if (!registrosValidos.length) {
      return res.status(200).json({
        mensagem: 'Nenhum registro válido encontrado',
        totalProcessados: 0
      });
    }

    // SINCRONIZAÇÃO POSTGRES
    const banco = {
      inseridos: 0,
      atualizados: 0,
      ignorados: 0,
      erros: 0,
      total: registrosValidos.length
    };

    for (const funcionario of registrosValidos) {
      try {
        const status = await inserirFuncionario(funcionario);
        if (status === 'inserido') {
          banco.inseridos++;
        } else if (status === 'atualizado') {
          banco.atualizados++;
        } else {
          banco.ignorados++;
        }
      } catch (err) {
        banco.erros++;
        console.error(`Erro ao inserir matrícula ${funcionario.matricula}:`, err.message);
      }
    }

    console.log("Sincronização ao banco de dados concluida.");

    // SINCRONIZAÇÃO GOOGLE SHEETS
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_NAME;

    let resultadoPlanilha = null;

    if (spreadsheetId && sheetName) {
      try {
        resultadoPlanilha = await sincronizarPlanilha(
          spreadsheetId,
          sheetName,
          registrosValidos
        );
      } catch (err) {
        console.error("Erro ao sincronizar planilha:", err.message);
        resultadoPlanilha = { erro: err.message };
      }
    } else {
      resultadoPlanilha = { aviso: 'Google Sheets não configurado no .env' };
    }

    console.log("Sincronização com planilha concluída.");


    // RESPOSTA FINAL
    return res.json({
      mensagem: 'Sincronização concluída com sucesso',
      totalProcessados: registrosValidos.length,
      banco,
      planilha: resultadoPlanilha
    });

  } catch (error) {
    console.error('ERRO GERAL:', error);

    return res.status(500).json({
      erro: 'Erro na sincronização',
      detalhes: error.message
    });
  }
}

module.exports = { importarArquivos };