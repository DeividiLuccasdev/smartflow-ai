import { app } from "./app.js";
import { iniciarRelayOutbox } from "./lib/outbox.js";

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
    console.log(`CRM Service rodando na porta ${PORT}`);
});

// Entrega em segundo plano os pedidos de oportunidades ganhas que não
// puderam ser enviados na hora ao ERP (ex.: ERP dormindo no Render).
iniciarRelayOutbox();
