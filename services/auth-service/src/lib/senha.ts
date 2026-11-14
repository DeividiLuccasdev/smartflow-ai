import bcrypt from "bcryptjs";

// Mesmo custo usado em todo o serviço: cadastro de usuários e seed da demo.
const RODADAS_BCRYPT = 10;

export function gerarHashSenha(senha: string) {
    return bcrypt.hash(senha, RODADAS_BCRYPT);
}
