import { app } from "./app.js";

const PORT = process.env.PORT || 3004;

app.listen(PORT, () => {
    console.log(`Finance Service rodando na porta ${PORT}`);
});
