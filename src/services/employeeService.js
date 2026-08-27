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

    // ===============================
    // 1️⃣ LISTA_FUNCIONARIO
    // ===============================
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

    // ===============================
    // 2️⃣ COLABORADORES
    // ===============================
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

    // Se não foi inserido e houve update → é atualização
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

module.exports = {
  inserirFuncionario
};