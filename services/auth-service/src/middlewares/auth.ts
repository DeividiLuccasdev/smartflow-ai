import type {
    Request,
    Response,
    NextFunction
} from "express";

import jwt from "jsonwebtoken";

export interface RequestAutenticada extends Request {
    usuario?: {
        usuarioId: number;
        perfil: string;
    };
}

export function autenticarToken(
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

    try {
        const dados = jwt.verify(token, segredo) as {
            usuarioId: number;
            perfil: string;
        };

        req.usuario = {
            usuarioId: dados.usuarioId,
            perfil: dados.perfil
        };

        next();

    } catch {
        return res.status(401).json({
            erro: "Token inválido ou expirado."
        });
    }
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