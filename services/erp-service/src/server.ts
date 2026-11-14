import { app } from "./app.js";
import { iniciarRelayOutbox } from "./lib/outbox.js";

const PORT = process.env.PORT || 3003;

app.listen(PORT, () => {
    console.log(`ERP Service rodando na porta ${PORT}`);
});

// Entrega em segundo plano os eventos para o Financeiro que não puderam
// ser enviados na hora (ex.: Financeiro dormindo no Render).
iniciarRelayOutbox();
