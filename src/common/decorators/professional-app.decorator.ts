import { SetMetadata } from "@nestjs/common";

export const PROFESSIONAL_APP_KEY = "professionalApp";

/**
 * Marca uma rota como do app do profissional. O perfil PROFESSIONAL só entra
 * nas rotas marcadas (nega por padrão): sem a marca, 403, mesmo que a rota não
 * tenha @Roles. Quem não é PROFESSIONAL não é afetado.
 */
export const ProfessionalApp = () => SetMetadata(PROFESSIONAL_APP_KEY, true);
