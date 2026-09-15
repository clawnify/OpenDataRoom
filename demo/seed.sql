-- Fictional deal rooms. Uploads and access settings belong only to the demo.
INSERT INTO datarooms (id, name, description) VALUES
 ('room-property', 'Maple House · Buyer information', 'A sample room for sharing property information with a prospective buyer.'),
 ('room-onboarding', 'Client onboarding', 'A sample checklist and document space for a new client.');
INSERT INTO dataroom_folders (id, dataroom_id, name, position) VALUES
 ('folder-property', 'room-property', 'Property details', 0),
 ('folder-compliance', 'room-property', 'Certificates and reports', 1),
 ('folder-client', 'room-onboarding', 'Getting started', 0);
INSERT INTO settings (id, company_name, accent_color) VALUES (1, 'Maple House', '#315A48');
