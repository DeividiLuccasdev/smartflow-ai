import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, obterUsuario } from "../services/api";

type Perfil = "ADMIN" | "VENDEDOR" | "ATENDENTE";

type Usuario = {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  criadoEm: string;
};

function UsuariosPage() {
  const usuarioLogado = obterUsuario();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [perfil, setPerfil] = useState<Perfil>("VENDEDOR");

  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  async function carregarUsuarios() {
    try {
      setCarregando(true);
      setErro("");

      const resposta = await apiFetch("/auth/usuarios");

      const dados = await resposta.json();

      if (!resposta.ok) {
        throw new Error(
          dados.erro || "Não foi possível carregar os usuários."
        );
      }

      setUsuarios(dados);
    } catch (erro) {
      setErro(
        erro instanceof Error
          ? erro.message
          : "Erro ao carregar usuários."
      );
    } finally {
      setCarregando(false);
    }
  }

  async function cadastrarUsuario(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    try {
      setSalvando(true);
      setErro("");
      setSucesso("");

      const resposta = await apiFetch("/auth/usuarios", {
        method: "POST",
        body: JSON.stringify({
          nome,
          email,
          senha,
          perfil,
        }),
      });

      const dados = await resposta.json();

      if (!resposta.ok) {
        throw new Error(
          dados.erro || "Não foi possível cadastrar o usuário."
        );
      }

      setSucesso("Usuário cadastrado com sucesso.");

      setNome("");
      setEmail("");
      setSenha("");
      setPerfil("VENDEDOR");

      await carregarUsuarios();
    } catch (erro) {
      setErro(
        erro instanceof Error
          ? erro.message
          : "Erro ao cadastrar usuário."
      );
    } finally {
      setSalvando(false);
    }
  }


  async function alterarStatusUsuario(
    usuario: Usuario
  ) {
    try {
      setErro("");
      setSucesso("");

      const novoStatus = !usuario.ativo;

      const resposta = await apiFetch(
        `/auth/usuarios/${usuario.id}/ativo`,
        {
          method: "PATCH",
          body: JSON.stringify({
            ativo: novoStatus,
          }),
        }
      );

      const dados = await resposta.json();

      if (!resposta.ok) {
        throw new Error(
          dados.erro ||
            "Não foi possível alterar o status do usuário."
        );
      }

      setSucesso(dados.mensagem);

      await carregarUsuarios();

    } catch (erro) {
      setErro(
        erro instanceof Error
          ? erro.message
          : "Erro ao alterar status do usuário."
      );
    }
  }
  useEffect(() => {
    carregarUsuarios();
  }, []);

  return (
    <main className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Administração</p>
          <h1>Usuários</h1>
          <p className="subtitle">
            Gerencie os usuários e perfis de acesso do SmartFlow.
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={carregarUsuarios}
          disabled={carregando}
        >
          {carregando ? "Atualizando..." : "Atualizar"}
        </button>
      </header>

      {erro && <div className="error-box">{erro}</div>}
      {sucesso && <div className="success-box">{sucesso}</div>}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Novo usuário</h2>
            <p>Cadastre um novo acesso ao sistema.</p>
          </div>
        </div>

        <form className="usuarios-form" onSubmit={cadastrarUsuario}>
          <div className="form-group">
            <label>Nome</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>Senha</label>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>Perfil</label>
            <select
              value={perfil}
              onChange={(e) => setPerfil(e.target.value as Perfil)}
            >
              <option value="ADMIN">ADMIN</option>
              <option value="VENDEDOR">VENDEDOR</option>
              <option value="ATENDENTE">ATENDENTE</option>
            </select>
          </div>

          <button
            className="refresh-button"
            type="submit"
            disabled={salvando}
          >
            {salvando ? "Cadastrando..." : "Cadastrar usuário"}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Usuários cadastrados</h2>
            <p>{usuarios.length} usuário(s)</p>
          </div>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>

            <tbody>
              {usuarios.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              ) : (
                usuarios.map((usuario) => (
                  <tr key={usuario.id}>
                    <td>{usuario.nome}</td>
                    <td>{usuario.email}</td>
                    <td>
                      <span className="service-tag">
                        {usuario.perfil}
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          usuario.ativo
                            ? "user-status active"
                            : "user-status inactive"
                        }
                      >
                        {usuario.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>

                    <td>
                      <button
                        className="user-action-button"
                        onClick={() =>
                          alterarStatusUsuario(usuario)
                        }
                        disabled={
                          usuario.id === usuarioLogado?.id &&
                          usuario.ativo
                        }
                      >
                        {usuario.id === usuarioLogado?.id &&
                        usuario.ativo
                          ? "Conta atual"
                          : usuario.ativo
                          ? "Desativar"
                          : "Ativar"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default UsuariosPage;




