import { useState, type FormEvent } from "react";

import { API_URL, salvarToken } from "../services/api";

type LoginResposta = {
  mensagem: string;
  usuario: {
    id: number;
    nome: string;
    email: string;
    perfil: string;
  };
  token: string;
};

function LoginPage() {


  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function entrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    try {
      setCarregando(true);
      setErro("");

      const resposta = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          senha,
        }),
      });

      const dados = await resposta.json();

      if (!resposta.ok) {
        throw new Error(
          dados.erro || "Não foi possível realizar o login."
        );
      }

      const login = dados as LoginResposta;

      salvarToken(login.token);

      localStorage.setItem(
        "smartflow_usuario",
        JSON.stringify(login.usuario)
      );

      window.location.href = "/";
    } catch (erro) {
      console.error(erro);

      setErro(
        erro instanceof Error
          ? erro.message
          : "Erro ao realizar login."
      );
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-icon">S</div>

          <div>
            <strong>SmartFlow</strong>
            <span>AI Business</span>
          </div>
        </div>

        <div className="login-header">
          <p className="eyebrow">Acesso ao sistema</p>
          <h1>Bem-vindo</h1>
          <p>Entre com sua conta para acessar o SmartFlow AI.</p>
        </div>

        {erro && <div className="error-box">{erro}</div>}

        <form className="login-form" onSubmit={entrar}>
          <div className="form-group">
            <label>E-mail</label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
            />
          </div>

          <div className="form-group">
            <label>Senha</label>

            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Sua senha"
              required
            />
          </div>

          <button
            className="refresh-button login-button"
            type="submit"
            disabled={carregando}
          >
            {carregando ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;

