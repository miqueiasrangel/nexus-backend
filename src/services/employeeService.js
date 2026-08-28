const pool = require('../database/connection');

function normalizar(valor) {
  if (valor === undefined || valor === null) return null;
  return String(valor).trim();
}

async function inserirFuncionario(funcionario) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      matricula,
      nome,
      setor_folha,
      nome_setor,
      gerente,
      funcao,
      rfid,
      codbarras
    } = funcionario;

    const agora = new Date();
    const data_att = agora.toLocaleDateString('pt-BR');
    const hora_att = agora.toLocaleTimeString('pt-BR');

    let tipoOperacao = 'ignorado';

    // 1️⃣ LISTA_FUNCIONARIO
    const resultLista = await client.query(
      `
      INSERT INTO colaborador.lista_funcionario
      (matricula, nome, setor_folha, nome_setor, gerente, funcao, data_att, hora_att)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (matricula)
      DO NOTHING
      RETURNING matricula
      `,
      [
        matricula,
        nome,
        setor_folha,
        nome_setor,
        gerente,
        funcao,
        data_att,
        hora_att
      ]
    );

    if (resultLista.rowCount > 0) {
      tipoOperacao = 'inserido';
    }

    // 2️⃣ COLABORADORES
    const resultColab = await client.query(
      `
      INSERT INTO colaborador.colaboradores
      (rfid, matricula, nome, usuarioupdate, updatedate, codbarras)
      VALUES ($1,$2,$3,$4,NOW(),$5)
      ON CONFLICT (matricula)
      DO UPDATE SET
        rfid = EXCLUDED.rfid,
        codbarras = EXCLUDED.codbarras,
        updatedate = NOW()
      WHERE
        colaborador.colaboradores.rfid IS DISTINCT FROM EXCLUDED.rfid
        OR
        colaborador.colaboradores.codbarras IS DISTINCT FROM EXCLUDED.codbarras
      RETURNING *
      `,
      [
        rfid && !isNaN(Number(rfid)) ? Number(rfid) : null,
        matricula,
        nome,
        'SISTEMA_IMPORTACAO',
        codbarras && !isNaN(Number(codbarras)) ? Number(codbarras) : null
      ]
    );

    if (tipoOperacao !== 'inserido' && resultColab.rowCount > 0) {
      tipoOperacao = 'atualizado';
    }

    await client.query('COMMIT');

    return tipoOperacao;

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('ERRO inserirFuncionario:', error);
    throw error;
  } finally {
    client.release();
  }
}

// =========================================================================
// 🚀 INSERÇÃO EM LOTE OTIMIZADA (BULK INSERT) PARA PRODUÇÃO
// Reduz o tempo de inserção de vários minutos para poucos segundos
// =========================================================================
async function inserirFuncionariosEmLote(funcionarios, batchSize = 500) {
  if (!funcionarios || funcionarios.length === 0) {
    return { inseridos: 0, atualizados: 0, ignorados: 0, erros: 0, total: 0 };
  }

  const client = await pool.connect();

  let totalInseridos = 0;
  let totalAtualizados = 0;
  let totalIgnorados = 0;
  let totalErros = 0;

  try {
    await client.query('BEGIN');

    const agora = new Date();
    const data_att = agora.toLocaleDateString('pt-BR');
    const hora_att = agora.toLocaleTimeString('pt-BR');

    for (let i = 0; i < funcionarios.length; i += batchSize) {
      const lote = funcionarios.slice(i, i + batchSize);

      // 1️⃣ BULK INSERT: lista_funcionario
      const paramsLista = [];
      const valuesLista = [];
      let indexLista = 1;

      for (const func of lote) {
        valuesLista.push(
          `($${indexLista++}, $${indexLista++}, $${indexLista++}, $${indexLista++}, $${indexLista++}, $${indexLista++}, $${indexLista++}, $${indexLista++})`
        );
        paramsLista.push(
          func.matricula,
          func.nome,
          func.setor_folha,
          func.nome_setor,
          func.gerente,
          func.funcao,
          data_att,
          hora_att
        );
      }

      const queryLista = `
        INSERT INTO colaborador.lista_funcionario
        (matricula, nome, setor_folha, nome_setor, gerente, funcao, data_att, hora_att)
        VALUES ${valuesLista.join(', ')}
        ON CONFLICT (matricula) DO NOTHING
        RETURNING matricula;
      `;

      await client.query(queryLista, paramsLista);

      // 2️⃣ BULK INSERT / UPDATE: colaboradores
      const paramsColab = [];
      const valuesColab = [];
      let indexColab = 1;

      for (const func of lote) {
        valuesColab.push(
          `($${indexColab++}, $${indexColab++}, $${indexColab++}, $${indexColab++}, NOW(), $${indexColab++})`
        );
        const rfidNum = func.rfid && !isNaN(Number(func.rfid)) ? Number(func.rfid) : null;
        const codbarrasNum = func.codbarras && !isNaN(Number(func.codbarras)) ? Number(func.codbarras) : null;

        paramsColab.push(
          rfidNum,
          func.matricula,
          func.nome,
          'SISTEMA_IMPORTACAO',
          codbarrasNum
        );
      }

      const queryColab = `
        INSERT INTO colaborador.colaboradores
        (rfid, matricula, nome, usuarioupdate, updatedate, codbarras)
        VALUES ${valuesColab.join(', ')}
        ON CONFLICT (matricula)
        DO UPDATE SET
          rfid = EXCLUDED.rfid,
          codbarras = EXCLUDED.codbarras,
          updatedate = NOW()
        WHERE
          colaborador.colaboradores.rfid IS DISTINCT FROM EXCLUDED.rfid
          OR
          colaborador.colaboradores.codbarras IS DISTINCT FROM EXCLUDED.codbarras
        RETURNING matricula, (xmax = 0) AS foi_inserido;
      `;

      const resColab = await client.query(queryColab, paramsColab);

      let inseridosLote = 0;
      let atualizadosLote = 0;

      resColab.rows.forEach(r => {
        if (r.foi_inserido) {
          inseridosLote++;
        } else {
          atualizadosLote++;
        }
      });

      const ignoradosLote = lote.length - inseridosLote - atualizadosLote;

      totalInseridos += inseridosLote;
      totalAtualizados += atualizadosLote;
      totalIgnorados += Math.max(0, ignoradosLote);
    }

    await client.query('COMMIT');

    return {
      inseridos: totalInseridos,
      atualizados: totalAtualizados,
      ignorados: totalIgnorados,
      erros: totalErros,
      total: funcionarios.length
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro na gravação em lote do banco:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  inserirFuncionario,
  inserirFuncionariosEmLote
};