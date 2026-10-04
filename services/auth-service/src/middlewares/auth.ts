import type {
    Request,
    Response,
    NextFunction
} from "express";

import jwt from "jsonwebtoken";

import { prisma } from "../config/prisma.js";

export interface RequestAutenticada extends Request {
    usuario?: {
        usuarioId: number;
        perfil: string;
    };
}

export async function autenticarToken(
    req: RequestAutenticada,
    res: Response,
    next: NextFunction
) {
    const authorization = req.headers.authorization;

    if (!authorization) {
        return res.status(401).json({
            erro: "Token não informado."
        });
    }

    const [tipo, token] = authorization.split(" ");

    if (tipo !== "Bearer" || !token) {
        return res.status(401).json({
            erro: "Token inválido."
        });
    }

    const segredo = process.env.JWT_SECRET;

    if (!segredo) {
        throw new Error("JWT_SECRET não configurado.");
    }

    let dados: { usuarioId: number };

    try {
        dados = jwt.verify(token, segredo) as {
            usuarioId: number;
        };
    } catch {
        return res.status(401).json({
            erro: "Token inválido ou expirado."
        });
    }

    // Consulta o banco a cada requisição: usuários desativados perdem
    // o acesso na hora, e mudanças de perfil valem sem esperar o token expirar.
    const usuario = await prisma.usuario.findUnique({
        where: {
            id: dados.usuarioId
        },
        select: {
            id: true,
            perfil: true,
            ativo: true
        }
    });

    if (!usuario || !usuario.ativo) {
        return res.status(401).json({
            erro: "Token inválido ou expirado."
        });
    }

    req.usuario = {
        usuarioId: usuario.id,
        perfil: usuario.perfil
    };

    next();
}
export function autorizarPerfil(...perfisPermitidos: string[]) {
    return (
        req: RequestAutenticada,
        res: Response,
        next: NextFunction
    ) => {

        if (!req.usuario) {
            return res.status(401).json({
                erro: "Usuário não autenticado."
            });
        }

        if (!perfisPermitidos.includes(req.usuario.perfil)) {
            return res.status(403).json({
                erro: "Usuário sem permissão para acessar este recurso."
            });
        }

        next();
    };
}