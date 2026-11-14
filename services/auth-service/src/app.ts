import express from "express";
import cors from "cors";
import "dotenv/config";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { prisma } from "./config/prisma.js";
import { exigirChaveInterna } from "./middlewares/chaveInterna.js";
import { gerarHashSenha } from "./lib/senha.js";
import {
    ehContaDemo,
    ERRO_CONTA_DEMO,
    ERRO_DEMO_ALTERAR_USUARIOS,
    ERRO_DEMO_CRIAR_ADMIN
} from "./lib/usuarioDemo.js";

import {
    autenticarToken,
    autorizarPerfil,
    type RequestAutenticada
} from "./middlewares/auth.js";

export const app = express();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error("JWT_SECRET não configurado.");
}

app.use(cors());
app.use(exigirChaveInterna);
app.use(express.json());

app.get("/", (req, res) => {
    return res.json({
        servico: "Auth Service",
        status: "online"
    });
});

// ========================================
// CADASTRO DE USUÁRIO
// POST /usuarios
// ========================================

app.post(
    "/usuarios",
    autenticarToken,
    autorizarPerfil("ADMIN"),
    async (req: RequestAutenticada, res) => {
    try {
        const {
            nome,
            email,
            senha,
            perfil
        } = req.body ?? {};

        if (!nome || !email || !senha) {
            return res.status(400).json({
                erro: "Nome, e-mail e senha são obrigatórios."
            });
        }

        // A demo é ADMIN para mostrar todos os módulos, mas não pode
        // criar novos administradores.
        if (ehContaDemo(req.usuario?.email) && perfil === "ADMIN") {
            return res.status(403).json({
                erro: ERRO_DEMO_CRIAR_ADMIN
            });
        }

        const usuarioExistente = await prisma.usuario.findUnique({
            where: {
                email
            }
        });

        if (usuarioExistente) {
            return res.status(409).json({
                erro: "Já existe um usuário cadastrado com este e-mail."
            });
        }

        const senhaHash = await gerarHashSenha(senha);

        const perfilUsuario =
            perfil === "ADMIN" ||
            perfil === "ATENDENTE" ||
            perfil === "VENDEDOR"
                ? perfil
                : "VENDEDOR";

        const usuario = await prisma.usuario.create({
            data: {
                nome,
                email,
                senhaHash,
                perfil: perfilUsuario
            },
            select: {
                id: true,
                nome: true,
                email: true,
                perfil: true,
                ativo: true,
                criadoEm: true
            }
        });

        return res.status(201).json({
            mensagem: "Usuário cadastrado com sucesso.",
            usuario
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao cadastrar usuário."
        });
    }
});


// ========================================
// LISTAGEM DE USUÁRIOS
// GET /usuarios
// ========================================

app.get(
    "/usuarios",
    autenticarToken,
    autorizarPerfil("ADMIN"),
    async (req, res) => {
        try {
            const usuarios = await prisma.usuario.findMany({
                select: {
                    id: true,
                    nome: true,
                    email: true,
                    perfil: true,
                    ativo: true,
                    criadoEm: true
                },
                orderBy: {
                    nome: "asc"
                }
            });

            return res.status(200).json(usuarios);

        } catch (erro) {
            console.error(erro);

            return res.status(500).json({
                erro: "Erro interno ao listar usuários."
            });
        }
    }
);

// ========================================
// ATIVAR / DESATIVAR USUÁRIO
// PATCH /usuarios/:id/ativo
// ========================================

app.patch(
    "/usuarios/:id/ativo",
    autenticarToken,
    autorizarPerfil("ADMIN"),
    async (req: RequestAutenticada, res) => {
        try {
            const id = Number(req.params.id);
            const { ativo } = req.body ?? {};

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({
                    erro: "ID de usuário inválido."
                });
            }

            if (typeof ativo !== "boolean") {
                return res.status(400).json({
                    erro: "O campo ativo deve ser verdadeiro ou falso."
                });
            }

            // A demo não ativa nem desativa contas, inclusive as
            // contas reais de administrador.
            if (ehContaDemo(req.usuario?.email)) {
                return res.status(403).json({
                    erro: ERRO_DEMO_ALTERAR_USUARIOS
                });
            }

            if (
                req.usuario?.usuarioId === id &&
                ativo === false
            ) {
                return res.status(400).json({
                    erro: "Você não pode desativar a própria conta."
                });
            }

            const usuarioExistente = await prisma.usuario.findUnique({
                where: { id }
            });

            if (!usuarioExistente) {
                return res.status(404).json({
                    erro: "Usuário não encontrado."
                });
            }

            if (ehContaDemo(usuarioExistente.email)) {
                return res.status(403).json({
                    erro: ERRO_CONTA_DEMO
                });
            }

            const usuario = await prisma.usuario.update({
                where: { id },
                data: { ativo },
                select: {
                    id: true,
                    nome: true,
                    email: true,
                    perfil: true,
                    ativo: true,
                    criadoEm: true
                }
            });

            return res.status(200).json({
                mensagem: ativo
                    ? "Usuário ativado com sucesso."
                    : "Usuário desativado com sucesso.",
                usuario
            });

        } catch (erro) {
            console.error(erro);

            return res.status(500).json({
                erro: "Erro interno ao alterar o status do usuário."
            });
        }
    }
);
// ========================================
// LOGIN
// POST /login
// ========================================

app.post("/login", async (req, res) => {
    try {
        const {
            email,
            senha
        } = req.body ?? {};

        if (!email || !senha) {
            return res.status(400).json({
                erro: "E-mail e senha são obrigatórios."
            });
        }

        const usuario = await prisma.usuario.findUnique({
            where: {
                email
            }
        });

        if (!usuario) {
            return res.status(401).json({
                erro: "E-mail ou senha inválidos."
            });
        }

        const senhaValida = await bcrypt.compare(
            senha,
            usuario.senhaHash
        );

        if (!senhaValida) {
            return res.status(401).json({
                erro: "E-mail ou senha inválidos."
            });
        }

        // Só informa que o usuário está inativo depois de validar a senha,
        // para não revelar a terceiros quais e-mails estão cadastrados.
        if (!usuario.ativo) {
            return res.status(403).json({
                erro: "Usuário inativo."
            });
        }

        const token = jwt.sign(
            {
                usuarioId: usuario.id,
                email: usuario.email,
                perfil: usuario.perfil
            },
            JWT_SECRET,
            {
                expiresIn: "8h"
            }
        );

        return res.status(200).json({
            mensagem: "Login realizado com sucesso.",
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                perfil: usuario.perfil
            },
            token
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao realizar login."
        });
    }
});

// ========================================
// PERFIL AUTENTICADO
// GET /perfil
// ========================================

app.get(
    "/perfil",
    autenticarToken,
    (req: RequestAutenticada, res) => {
        return res.status(200).json({
            mensagem: "Acesso autorizado.",
            usuario: req.usuario
        });
    }
);

// ========================================
// ÁREA ADMINISTRATIVA
// GET /admin
// ========================================

app.get(
    "/admin",
    autenticarToken,
    autorizarPerfil("ADMIN"),
    (req: RequestAutenticada, res) => {
        return res.json({
            mensagem: "Acesso de administrador autorizado.",
            usuario: req.usuario
        });
    }
);
