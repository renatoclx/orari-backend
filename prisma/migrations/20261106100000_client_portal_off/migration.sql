-- Portal do cliente e Mensagens desligados em todas as empresas (2026-11-06).
--
-- A migração 20261104192412_portal_rules deu o client-portal a todas as
-- empresas, e o item "Portal do cliente" aparecia no menu de todo ADMIN. O
-- portal passa a ser liberado empresa por empresa pelo SUPER_ADMIN (Acessos e
-- limites), como as Mensagens, que dependem dele.
--
-- Só a liberação é apagada: as regras que cada clínica salvou (portal_settings),
-- as contas dos clientes e os vínculos ficam. Ao liberar de novo, tudo volta a
-- valer como estava.
DELETE FROM "company_feature_access"
WHERE "feature" IN ('client-portal', 'messages');
