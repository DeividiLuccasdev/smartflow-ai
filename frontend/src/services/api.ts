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

  const resposta = await fetch(`${API_URL}${caminho}`, {
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
