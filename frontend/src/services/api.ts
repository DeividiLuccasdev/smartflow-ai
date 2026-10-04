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

async function servicoIniciando(resposta: Response) {
  if (resposta.status !== 502 && resposta.status !== 503) {
    return false;
  }

  try {
    const dados = await resposta.clone().json();

    return dados?.codigo === "SERVICE_STARTING";
  } catch {
    // 502/503 sem JSON: é o próprio Gateway ainda subindo
    return true;
  }
}

export async function fetchAguardandoServicos(
  url: string,
  opcoes: RequestInit = {},
  aoAguardar?: () => void
) {
  const limite = Date.now() + ESPERA_MAXIMA_MS;

  for (;;) {
    try {
      const resposta = await fetch(url, opcoes);

      if (!(await servicoIniciando(resposta)) || Date.now() > limite) {
        return resposta;
      }
    } catch (erro) {
      // Falha de rede: o Gateway ainda está acordando
      if (Date.now() > limite) {
        throw erro;
      }
    }

    aoAguardar?.();
    await esperar(INTERVALO_TENTATIVA_MS);
  }
}

// Pede ao Gateway para acordar todos os serviços de uma vez.
export function acordarServicos() {
  fetch(`${API_URL}/acordar`).catch(() => {
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
