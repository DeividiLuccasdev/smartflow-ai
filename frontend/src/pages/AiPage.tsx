import { apiFetch } from "../services/api";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

function AiPage() {
  const [pergunta, setPergunta] = useState("");
  const [resposta, setResposta] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  async function perguntarIA() {
    if (!pergunta.trim()) {
      setErro("Digite uma pergunta.");
      return;
    }

    try {
      setCarregando(true);
      setErro("");
      setResposta("");

      const requisicao = await apiFetch(
        "/ia/assistente",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pergunta,
          }),
        }
      );

      const dados = await requisicao.json();

      if (!requisicao.ok) {
        throw new Error(
          dados.erro || "Erro ao consultar a IA."
        );
      }

      setResposta(dados.resposta);
    } catch (erro) {
      console.error(erro);

      setErro(
        erro instanceof Error
          ? erro.message
          : "Não foi possível consultar a IA."
      );
    } finally {
      setCarregando(false);
    }
  }

  return (
    <main className="content">
      <div className="topbar">
        <div>
          <p className="eyebrow">SmartFlow AI</p>
          <h1>Assistente Empresarial</h1>

          <p className="subtitle">
            Converse com seus dados de CRM, ERP e Financeiro.
          </p>
        </div>
      </div>

      {erro && (
        <div className="error-box">
          {erro}
        </div>
      )}

      <section className="ai-panel">
        <div className="ai-intro">
          <div className="ai-icon">AI</div>

          <div>
            <h2>Como posso ajudar?</h2>

            <p>
              Faça perguntas sobre vendas, pedidos,
              oportunidades e situação financeira.
            </p>
          </div>
        </div>

        <div className="ai-suggestions">
          <button
            onClick={() =>
              setPergunta(
                "Faça um resumo da situação atual da empresa."
              )
            }
          >
            Resumo da empresa
          </button>

          <button
            onClick={() =>
              setPergunta(
                "Quais oportunidades devo priorizar?"
              )
            }
          >
            Priorizar oportunidades
          </button>

          <button
            onClick={() =>
              setPergunta(
                "Como está a situação financeira?"
              )
            }
          >
            Situação financeira
          </button>
        </div>

        <textarea
          className="ai-input"
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          placeholder="Pergunte algo sobre sua empresa..."
          rows={4}
        />

        <div className="ai-actions">
          <button
            className="refresh-button"
            onClick={perguntarIA}
            disabled={carregando}
          >
            {carregando
              ? "Analisando..."
              : "Perguntar à IA"}
          </button>
        </div>
      </section>

      {resposta && (
        <section className="ai-response">
          <div className="ai-response-header">
            <div className="ai-icon">AI</div>

            <div>
              <strong>SmartFlow AI</strong>
              <span>Análise dos dados atuais</span>
            </div>
          </div>

          <div className="ai-response-text">
            <ReactMarkdown>
                {resposta.replace(/\\([#*_`])/g, "$1")}
            </ReactMarkdown>
            </div>
        </section>
      )}
    </main>
  );
}

export default AiPage;


