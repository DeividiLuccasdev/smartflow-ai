const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3000";

export function obterToken() {
  return localStorage.getItem("smartflow_token");
}

export function salvarToken(token: string) {
  localStorage.setItem("smartflow_token", token);
}

export function removerToken() {
  localStorage.removeItem("smartflow_token");
  localStorage.removeItem("smartflow_usuario");
}

// No plano gratuito do Render os serviços dormem após 15 min sem uso.
// Enquanto acordam, o Gateway responde 503 (SERVICE_STARTING) ou nem
// responde ainda; nesses casos a requisição é repetida em vez de falhar.
const INTERVALO_TENTATIVA_MS = 5000;
const ESPERA_MAXIMA_MS = 3 * 60 * 1000;

const esperar = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const CABECALHO_IDEMPOTENCIA = "Idempotency-Key";

// Repetir uma requisição só é seguro se ela não puder ter efeito duplicado:
// leituras (GET/HEAD) ou escritas com Idempotency-Key, que o servidor
// reconhece e responde com o resultado da primeira execução.
function podeRepetir(opcoes: RequestInit) {
  const metodo = (opcoes.method ?? "GET").toUpperCase();

  return (
    metodo === "GET" ||
    metodo === "HEAD" ||
    new Headers(opcoes.headers).has(CABECALHO_IDEMPOTENCIA)
  );
}

// "naoEncaminhada": o Gateway respondeu SERVICE_STARTING antes de repassar a
// requisição ao serviço, então repetir é sempre seguro.
// "talvezEncaminhada": 502/503 sem JSON ou falha de rede; a requisição pode
// ter chegado ao serviço, então só repete se for idempotente.
async function servicoIniciando(
  resposta: Response
): Promise<false | "naoEncaminhada" | "talvezEncaminhada"> {
  if (resposta.status !== 502 && resposta.status !== 503) {
    return false;
  }

  try {
    const dados = await resposta.clone().json();

    return dados?.codigo === "SERVICE_STARTING" ? "naoEncaminhada" : false;
  } catch {
    // 502/503 sem JSON: é o próprio Gateway ainda subindo
    return "talvezEncaminhada";
  }
}

export async function fetchAguardandoServicos(
  url: string,
  opcoes: RequestInit = {},
  aoAguardar?: () => void,
  // Para requisições sem efeito colateral que não são GET (ex.: login)
  { repetirSempre = false }: { repetirSempre?: boolean } = {}
) {
  const limite = Date.now() + ESPERA_MAXIMA_MS;
  const repetivel = repetirSempre || podeRepetir(opcoes);

  for (;;) {
    try {
      const resposta = await fetch(url, opcoes);
      const iniciando = await servicoIniciando(resposta);

      if (
        !iniciando ||
        (iniciando === "talvezEncaminhada" && !repetivel) ||
        Date.now() > limite
      ) {
        return resposta;
      }
    } catch (erro) {
      // Falha de rede: o Gateway pode estar acordando, mas a requisição
      // também pode ter chegado e só a resposta se perdeu.
      if (!repetivel || Date.now() > limite) {
        throw erro;
      }
    }

    aoAguardar?.();
    acordarServicos();
    await esperar(INTERVALO_TENTATIVA_MS);
  }
}

const CHAVE_URLS_SERVICOS = "smartflow_servicos";
const INTERVALO_ACORDAR_MS = 15000;
let ultimoAcordar = 0;

// Chama a rota "/" de cada microsserviço direto do navegador. No plano
// gratuito o Render pode recusar (429) as chamadas do Gateway para acordar
// os serviços, mas aceita as do navegador.
function chamarServicos(urls: string[]) {
  for (const url of urls) {
    fetch(url, { mode: "no-cors" }).catch(() => {
      // Só importa disparar a requisição: o serviço acorda ao recebê-la
    });
  }
}

function urlsSalvas(): string[] {
  try {
    const salvas = JSON.parse(
      localStorage.getItem(CHAVE_URLS_SERVICOS) || "[]"
    );

    return Array.isArray(salvas) ? salvas : [];
  } catch {
    return [];
  }
}

// Acorda o Gateway e todos os serviços de uma vez.
export function acordarServicos() {
  const agora = Date.now();

  if (agora - ultimoAcordar < INTERVALO_ACORDAR_MS) {
    return;
  }

  ultimoAcordar = agora;

  // Em visitas seguintes já dá para acordar sem esperar o Gateway subir
  chamarServicos(urlsSalvas());

  fetch(`${API_URL}/acordar`)
    .then((resposta) => resposta.json())
    .then((dados: { servicos?: string[] }) => {
      if (!Array.isArray(dados.servicos)) {
        return;
      }

      localStorage.setItem(
        CHAVE_URLS_SERVICOS,
        JSON.stringify(dados.servicos)
      );

      chamarServicos(dados.servicos);
    })
    .catch(() => {
      // O próprio Gateway pode estar dormindo; a requisição já o acorda
    });
}

export async function apiFetch(
  caminho: string,
  opcoes: RequestInit = {}
) {
  const token = obterToken();

  const headers = new Headers(opcoes.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (opcoes.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Uma chave por ação do usuário (cada chamada de apiFetch), reaproveitada
  // em todas as tentativas de fetchAguardandoServicos. Se a resposta se
  // perder e a requisição for repetida, o servidor não executa de novo.
  const metodo = (opcoes.method ?? "GET").toUpperCase();

  if (
    metodo !== "GET" &&
    metodo !== "HEAD" &&
    !headers.has(CABECALHO_IDEMPOTENCIA)
  ) {
    headers.set(CABECALHO_IDEMPOTENCIA, crypto.randomUUID());
  }

  const resposta = await fetchAguardandoServicos(`${API_URL}${caminho}`, {
    ...opcoes,
    headers,
  });

  if (resposta.status === 401) {
    removerToken();

    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  }

  return resposta;
}

export { API_URL };


export type UsuarioLogado = {
  id: number;
  nome: string;
  email: string;
  perfil: "ADMIN" | "VENDEDOR" | "ATENDENTE";
};

export function obterUsuario(): UsuarioLogado | null {
  const usuario = localStorage.getItem("smartflow_usuario");

  if (!usuario) {
    return null;
  }

  try {
    return JSON.parse(usuario) as UsuarioLogado;
  } catch {
    return null;
  }
}
