import dotenv from 'dotenv';

dotenv.config();

export const PORT = process.env.PORT || 3000;
export const RP_ID = process.env.RP_ID || 'localhost';
export const RP_NAME = process.env.RP_NAME || 'YubiKey Auth Demo';
export const ORIGIN = process.env.ORIGIN || `http://localhost:${PORT}`;
export const ATTESTATION = process.env.ATTESTATION || 'none'; // or "direct" for device details
