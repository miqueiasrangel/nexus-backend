function texto(valor) {
  if (valor === undefined || valor === null) return null;
  const resultado = String(valor).trim();
  return resultado === '' ? null : resultado;
}

function chaveNome(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function criarIndiceBase(base) {
  const matriculas = new Set(base.map((funcionario) => funcionario.matricula));
  const porTamanhoESufixo = new Map();
  const porNome = new Map();
  const porBarras = new Map();

  for (const matricula of matriculas) {
    const tamanho = String(matricula).length;
    if (!porTamanhoESufixo.has(tamanho)) {
      porTamanhoESufixo.set(tamanho, new Map());
    }

    const mapa = porTamanhoESufixo.get(tamanho);
    if (!mapa.has(String(matricula))) mapa.set(String(matricula), new Set());
    mapa.get(String(matricula)).add(String(matricula));
  }

  for (const funcionario of base) {
    const barras = texto(funcionario.codbarras);
    if (barras) {
      if (!porBarras.has(barras)) porBarras.set(barras, new Set());
      porBarras.get(barras).add(funcionario.matricula);
    }

    const nome = chaveNome(funcionario.nome);
    if (!nome) continue;
    if (!porNome.has(nome)) porNome.set(nome, new Set());
    porNome.get(nome).add(funcionario.matricula);
  }

  return { matriculas, porTamanhoESufixo, porNome, porBarras };
}

function resolverMatriculaREP(registro, indiceBase) {
  const matriculaREP = texto(registro.matricula);

  if (matriculaREP && indiceBase.matriculas.has(matriculaREP)) {
    return { matricula: matriculaREP, metodo: 'matricula' };
  }

  const candidatosPorSufixo = new Set();
  for (const [tamanho, mapa] of indiceBase.porTamanhoESufixo) {
    if (!matriculaREP || matriculaREP.length <= tamanho) continue;
    const sufixo = matriculaREP.slice(-tamanho);
    const candidatos = mapa.get(sufixo);
    if (candidatos) {
      for (const candidato of candidatos) candidatosPorSufixo.add(candidato);
    }
  }

  if (candidatosPorSufixo.size === 1) {
    return {
      matricula: [...candidatosPorSufixo][0],
      metodo: 'sufixo_matricula'
    };
  }

  const candidatosPorBarras = indiceBase.porBarras.get(texto(registro.codbarras));
  if (candidatosPorBarras && candidatosPorBarras.size === 1) {
    return {
      matricula: [...candidatosPorBarras][0],
      metodo: 'barras_base'
    };
  }

  const candidatosPorNome = indiceBase.porNome.get(chaveNome(registro.nome));
  if (candidatosPorNome && candidatosPorNome.size === 1) {
    return {
      matricula: [...candidatosPorNome][0],
      metodo: 'nome_unico'
    };
  }

  return {
    matricula: matriculaREP || null,
    metodo: null
  };
}

function calcularTurno(setor) {
  const valor = texto(setor);
  if (!valor) return 'C';

  const ultimaLetra = valor.slice(-1).toUpperCase();
  if (ultimaLetra === 'A' || ultimaLetra === 'B' || ultimaLetra === 'C') {
    return ultimaLetra;
  }

  return 'C';
}

function turnoValido(turno, setor) {
  const valor = texto(turno);
  if (valor && ['A', 'B', 'C'].includes(valor.toUpperCase())) {
    return valor.toUpperCase();
  }

  return calcularTurno(setor);
}

const PRIORIDADE_RESOLUCAO = {
  matricula: 4,
  sufixo_matricula: 3,
  barras_base: 2,
  nome_unico: 1,
  sem_correspondencia: 0
};

function prioridadeResolucao(registro) {
  return PRIORIDADE_RESOLUCAO[registro.metodo || 'sem_correspondencia'] || 0;
}

function valoresUnicos(registros, campo) {
  return Array.from(new Set(
    registros
      .map((registro) => texto(registro[campo]))
      .filter(Boolean)
  ));
}

function contextoRegistro(registro, matricula) {
  return {
    matricula,
    nome: registro.nome || null,
    origem: registro.origem || null,
    linha: registro.linha || null,
    matriculaREP: registro.matricula_rep || null,
    metodo: registro.metodo || null
  };
}

function adicionarAlertaRegistroSecundario(alertas, selecionado, secundario, campo, valorSelecionado) {
  const valorSecundario = texto(secundario[campo]);
  if (!valorSecundario || valorSecundario === valorSelecionado) return;

  alertas.push({
    tipo: 'registro_secundario_ignorado',
    motivo: 'Registro de menor confiança não foi usado para atualizar o identificador.',
    campo,
    matricula: selecionado.matricula,
    nome: selecionado.nome || secundario.nome || null,
    origem: secundario.origem || null,
    linha: secundario.linha || null,
    matriculaREP: secundario.matricula_rep || null,
    metodoEscolhido: selecionado.metodo || null,
    metodoIgnorado: secundario.metodo || null,
    valorEscolhido: valorSelecionado || null,
    valorIgnorado: valorSecundario
  });
}

function consolidarGrupoREP(matricula, registros, conflitos, alertas) {
  const maiorPrioridade = Math.max(...registros.map(prioridadeResolucao));
  const candidatos = registros.filter(
    (registro) => prioridadeResolucao(registro) === maiorPrioridade
  );
  const selecionado = {
    ...candidatos[0],
    matricula,
    origens: Array.from(new Set(registros.map((registro) => registro.origem).filter(Boolean)))
  };

  for (const campo of ['rfid', 'codbarras']) {
    const valoresConfiaveis = valoresUnicos(candidatos, campo);

    if (valoresConfiaveis.length > 1) {
      const valorAtual = valoresConfiaveis[0];
      for (const valorNovo of valoresConfiaveis.slice(1)) {
        const registroComValor = candidatos.find(
          (registro) => texto(registro[campo]) === valorNovo
        );
        conflitos.push({
          campo,
          atual: valorAtual,
          novo: valorNovo,
          ...contextoRegistro(registroComValor || candidatos[0], matricula),
          motivo: 'Identificadores diferentes em registros com a mesma confiança.'
        });
      }
      selecionado[campo] = valorAtual;
    } else {
      selecionado[campo] = valoresConfiaveis[0] || null;
    }

    for (const secundario of registros) {
      if (secundario === selecionado || candidatos.includes(secundario)) continue;
      adicionarAlertaRegistroSecundario(
        alertas,
        selecionado,
        secundario,
        campo,
        selecionado[campo]
      );
    }
  }

  return selecionado;
}

function consolidarREPs(registrosREP) {
  const porMatricula = new Map();
  const porBarras = new Map();
  const conflitos = [];
  const alertas = [];
  const grupos = new Map();
  const registrosSemCorrespondencia = [];

  for (const registro of registrosREP) {
    const chaveMatricula = texto(registro.matricula);

    if (!chaveMatricula || !registro.metodo) {
      registrosSemCorrespondencia.push(registro);
      continue;
    }

    if (!grupos.has(chaveMatricula)) grupos.set(chaveMatricula, []);
    grupos.get(chaveMatricula).push(registro);
  }

  for (const [matricula, registros] of grupos) {
    porMatricula.set(
      matricula,
      consolidarGrupoREP(matricula, registros, conflitos, alertas)
    );
  }

  // A validação de BARRAS deve considerar apenas os registros escolhidos
  // pela regra de confiança. Uma linha secundária ignorada não pode bloquear
  // a sincronização de um registro mais confiável.
  for (const registro of porMatricula.values()) {
    const chaveBarras = texto(registro.codbarras);
    if (!chaveBarras) continue;

    const anteriorBarras = porBarras.get(chaveBarras);
    if (anteriorBarras && anteriorBarras.matricula !== registro.matricula) {
      conflitos.push({
        campo: 'codbarras',
        origem: registro.origem,
        matricula: registro.matricula,
        atual: anteriorBarras.matricula,
        novo: registro.matricula,
        motivo: 'BARRAS associada a matrículas diferentes em registros confiáveis.'
      });
    } else {
      porBarras.set(chaveBarras, registro);
    }
  }

  return {
    porMatricula,
    porBarras,
    conflitos,
    alertas,
    registrosSemCorrespondencia
  };
}

function mesclarBaseComREPs(base, registrosREP) {
  const indiceBase = criarIndiceBase(base);
  const registrosREPResolvidos = registrosREP.map((registro) => ({
    ...registro,
    ...resolverMatriculaREP(registro, indiceBase)
  }));
  const {
    porMatricula,
    porBarras,
    conflitos,
    alertas,
    registrosSemCorrespondencia
  } = consolidarREPs(
    registrosREPResolvidos
  );
  const matriculasBase = new Set(base.map((funcionario) => funcionario.matricula));
  const registros = [];

  for (const funcionario of base) {
    let rep = porMatricula.get(funcionario.matricula);

    if (!rep && funcionario.codbarras) {
      rep = porBarras.get(funcionario.codbarras);
    }

    registros.push({
      matricula: funcionario.matricula,
      nome: funcionario.nome,
      setor: funcionario.setor,
      nome_setor: funcionario.nome_setor || funcionario.setor,
      setor_folha: funcionario.setor_folha || null,
      gerente: funcionario.gerente,
      funcao: funcionario.funcao || null,
      turno: turnoValido(funcionario.turno, funcionario.setor),
      nome_exibicao: funcionario.nome_exibicao || funcionario.nome,
      setor_exibicao: funcionario.setor_exibicao || funcionario.setor,
      gerente_exibicao: funcionario.gerente_exibicao || funcionario.gerente,
      situacao: funcionario.situacao || null,
      rfid: rep && rep.rfid ? rep.rfid : funcionario.rfid || null,
      codbarras: rep && rep.codbarras ? rep.codbarras : funcionario.codbarras || null,
      rep_found: Boolean(rep),
      rep_origins: rep
        ? rep.origens || [rep.origem]
        : []
    });
  }

  const registrosSemBase = [...registrosSemCorrespondencia];
  for (const registro of registrosREPResolvidos) {
    if (registrosSemCorrespondencia.includes(registro)) continue;
    const encontradoPorMatricula = registro.matricula &&
      matriculasBase.has(registro.matricula);

    if (!encontradoPorMatricula) {
      registrosSemBase.push(registro);
    }
  }

  return {
    registros,
    conflitos,
    alertas,
    registrosSemBase,
    totalBase: base.length,
    totalComREP: registros.filter((registro) => registro.rep_found).length,
    totalSemREP: registros.filter((registro) => !registro.rep_found).length,
    metodosREP: registrosREPResolvidos.reduce((contagem, registro) => {
      const metodo = registro.metodo || 'sem_correspondencia';
      contagem[metodo] = (contagem[metodo] || 0) + 1;
      return contagem;
    }, {})
  };
}

module.exports = {
  calcularTurno,
  mesclarBaseComREPs
};
