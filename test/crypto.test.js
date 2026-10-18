import test from 'node:test';
import assert from 'node:assert/strict';
import { signJWT, verifyJWT, hashPassword, verifyPassword } from '../functions/api/crypto.js';

test('Security & Crypto Suite', async (t) => {
    const testSecret = 'test_ultra_secret_key_1234567890';

    await t.test('1. signJWT and verifyJWT valid flow', async () => {
        const payload = { sub: 'farmer@dairy.farm', role: 'farmer', farm_id: 'farm-123', exp: Math.floor(Date.now() / 1000) + 3600 };
        const token = await signJWT(payload, testSecret);
        
        assert.ok(token);
        assert.equal(token.split('.').length, 3);

        const decoded = await verifyJWT(token, testSecret);
        assert.equal(decoded.sub, 'farmer@dairy.farm');
        assert.equal(decoded.role, 'farmer');
        assert.equal(decoded.farm_id, 'farm-123');
    });

    await t.test('2. verifyJWT rejects tampered signature or invalid secret', async () => {
        const payload = { sub: 'hacker@bad.actor' };
        const token = await signJWT(payload, testSecret);
        
        // Attempt verify with wrong secret
        const badSecretResult = await verifyJWT(token, 'wrong_secret');
        assert.equal(badSecretResult, null);

        // Tamper with payload
        const parts = token.split('.');
        const tampered = `${parts[0]}.eyJoYWNrZWQiOnRydWV9.${parts[2]}`;
        const tamperedResult = await verifyJWT(tampered, testSecret);
        assert.equal(tamperedResult, null);
    });

    await t.test('3. signJWT throws when secret is missing (Fail-Safe)', async () => {
        await assert.rejects(
            async () => await signJWT({ sub: 'test' }, null),
            /JWT_SECRET_KEY is not configured/
        );
    });

    await t.test('4. hashPassword and verifyPassword using PBKDF2 with salt', async () => {
        const plainPassword = 'k9#Vm8$xL2!zQ5@wR7^yP4*tN1~bC6';
        const hash = await hashPassword(plainPassword);

        assert.ok(hash.startsWith('pbkdf2_sha256$100000$'));
        
        // Check valid password
        const isMatch = await verifyPassword(plainPassword, hash);
        assert.equal(isMatch, true);

        // Check invalid password
        const isWrong = await verifyPassword('WrongPassword123', hash);
        assert.equal(isWrong, false);
    });
});
