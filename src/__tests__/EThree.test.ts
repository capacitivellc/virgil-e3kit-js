import EThree from '../EThree';
import { VirgilPublicKey } from 'virgil-crypto';
import {
    EmptyArrayError,
    RegisterRequiredError,
    LookupError,
    LookupNotFoundError,
    MultithreadError,
    PrivateKeyAlreadyExistsError,
    PrivateKeyNoBackupError,
    IdentityAlreadyExistsError,
} from '../errors';
import VirgilToolbox from '../VirgilToolbox';
import {
    generator,
    clear,
    keyknoxStorage,
    createSyncStorage,
    keyStorage,
    cardManager,
    createFetchToken,
    virgilCrypto,
} from './utils';
import { CachingJwtProvider, IKeyEntry } from 'virgil-sdk';

describe('VirgilE2ee', () => {
    const identity = 'virgiltest' + Date.now();
    const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());
    clear();

    it('full integration test', async done => {
        const sdk = await EThree.initialize(fetchToken);
        const password = 'secret_password';
        const cloudStorage = await createSyncStorage(identity, password);
        await sdk.register();
        const privateKey = await keyStorage.load(identity);
        expect(privateKey).not.toEqual(null);
        await sdk.backupPrivateKey(password);
        const encrypted = (await sdk.encrypt('message')) as string;
        await sdk.cleanup();
        const key = await keyStorage.load(identity);
        expect(key).toBeNull();

        try {
            await sdk.decrypt(encrypted!);
        } catch (e) {
            expect(e).toBeInstanceOf(Error);
        }

        await sdk.resetPrivateKeyBackup(password);
        try {
            await cloudStorage.sync();
            const cloudKey = await cloudStorage.retrieveEntry(identity);
            expect(cloudKey).not.toBeDefined();
        } catch (e) {
            expect(e).toBeInstanceOf(Error);
        }

        done();
    });
});

describe('EThree.register (without password)', () => {
    clear();
    it('STA-1 has no local key, has no card', async done => {
        const identity = 'virgiltestlocalnokeynocard' + Date.now();
        const fetchToken = createFetchToken(identity);
        const prevCards = await cardManager.searchCards(identity);
        expect(prevCards.length).toBe(0);
        const sdk = await EThree.initialize(fetchToken);
        await sdk.register();
        const [cards, key] = await Promise.all([
            cardManager.searchCards(identity),
            keyStorage.load(identity),
        ]);
        expect(cards.length).toBe(1);
        expect(key).not.toBe(null);
        done();
    });

    it('has local key, has no card', async done => {
        const identity = 'virgiltestlocal2' + Date.now();
        const fetchToken = createFetchToken(identity);
        const sdk = await EThree.initialize(fetchToken);
        const keyPair = virgilCrypto.generateKeys();
        keyStorage.save({
            name: identity,
            value: virgilCrypto.exportPrivateKey(keyPair.privateKey),
        });
        await sdk.register();
        const cards = await cardManager.searchCards(identity);
        expect(cards.length).toEqual(1);
        done();
    });

    it('has local key, has card', async done => {
        const identity = 'virgiltestlocal3' + Date.now();
        const keyPair = virgilCrypto.generateKeys();
        await cardManager.publishCard({ identity: identity, ...keyPair });
        await keyStorage.save({
            name: identity,
            value: virgilCrypto.exportPrivateKey(keyPair.privateKey),
        });
        const fetchToken = createFetchToken(identity);
        const prevCards = await cardManager.searchCards(identity);

        expect(prevCards.length).toEqual(1);

        const sdk = await EThree.initialize(fetchToken);
        try {
            await sdk.register();
        } catch (e) {
            expect(e).toBeInstanceOf(IdentityAlreadyExistsError);
        }

        done();
    });

    it('has no local key, has card', async done => {
        await keyStorage.clear();
        const identity = 'virgiltestlocal4' + Date.now();
        const keyPair = virgilCrypto.generateKeys();
        await cardManager.publishCard({ identity: identity, ...keyPair });
        const fetchToken = createFetchToken(identity);
        const sdk = await EThree.initialize(fetchToken);
        const cards = await cardManager.searchCards(identity);

        expect(cards.length).toEqual(1);

        try {
            await sdk.register();
        } catch (e) {
            expect(e).toBeDefined();
            return done();
        }
        done('should throw error');
    });

    it('call 2 times', async done => {
        const identity = 'virgiltestregister' + Date.now();
        const fetchToken = createFetchToken(identity);
        const prevCards = await cardManager.searchCards(identity);
        expect(prevCards.length).toBe(0);
        const sdk = await EThree.initialize(fetchToken);
        const promise = sdk.register();
        try {
            await sdk.register();
        } catch (e) {
            expect(e).toBeInstanceOf(MultithreadError);
        }
        await promise;
        const [cards, key] = await Promise.all([
            cardManager.searchCards(identity),
            keyStorage.load(identity),
        ]);
        expect(cards.length).toBe(1);
        expect(key).not.toBe(null);
        done();
    });
});

describe('EThree.rotatePrivateKey', () => {
    clear();
    it('has card', async done => {
        const identity = 'virgiltestrotate1' + Date.now();
        const fetchToken = createFetchToken(identity);
        const sdk = await EThree.initialize(fetchToken);
        await sdk.register();
        const cards = await cardManager.searchCards(identity);
        expect(cards.length).toEqual(1);
        const privateKeyData = await keyStorage.load(identity);
        expect(privateKeyData).not.toBeFalsy();
        await sdk.cleanup();
        await sdk.rotatePrivateKey();
        const previousPrivateKey = privateKeyData!.value.toString('base64');
        const newPrivateKeyData = await keyStorage.load(identity);
        expect(newPrivateKeyData).not.toBeFalsy();
        const newPrivateKey = newPrivateKeyData!.value.toString('base64');
        expect(previousPrivateKey).not.toEqual(newPrivateKey);
        const newCards = await cardManager.searchCards(identity);
        expect(newCards.length).toBe(1);
        expect(newCards[0].previousCardId).toBe(cards[0].id);
        done();
    });

    it('has no card', async done => {
        const identity = 'virgiltestrotate2' + Date.now();
        const fetchToken = createFetchToken(identity);
        const sdk = await EThree.initialize(fetchToken);
        const cards = await cardManager.searchCards(identity);
        expect(cards.length).toEqual(0);
        try {
            await sdk.rotatePrivateKey();
        } catch (e) {
            expect(e).toBeInstanceOf(RegisterRequiredError);
            return done();
        }
        done('should throw');
    });

    it('rotate 2 times', async done => {
        const identity = 'virgiltestrotate3' + Date.now();
        const fetchToken = createFetchToken(identity);
        const sdk = await EThree.initialize(fetchToken);
        await sdk.register();
        const cards = await cardManager.searchCards(identity);
        expect(cards.length).toEqual(1);
        await sdk.cleanup();
        const promise = sdk.rotatePrivateKey();
        try {
            await sdk.rotatePrivateKey();
        } catch (e) {
            expect(e).toBeInstanceOf(MultithreadError);
        }
        await promise;
        const newCards = await cardManager.searchCards(identity);
        expect(newCards.length).toBe(1);
        expect(newCards[0].previousCardId).toBe(cards[0].id);
        done();
    });
});

describe('lookupKeys', () => {
    clear();
    const identity = 'virgiltestlookup' + Date.now();
    const fetchToken = createFetchToken(identity);

    it('lookupKeys for one identity success', async done => {
        const sdk = await EThree.initialize(fetchToken);
        const identity = 'virgiltestlookup' + Date.now();
        const keypair = virgilCrypto.generateKeys();

        await cardManager.publishCard({ identity: identity, ...keypair });
        const publicKey = await sdk.lookupPublicKeys(identity);

        expect(Array.isArray(publicKey)).not.toBeTruthy();
        expect(virgilCrypto.exportPublicKey(publicKey).toString('base64')).toEqual(
            virgilCrypto.exportPublicKey(keypair.publicKey).toString('base64'),
        );
        done();
    });

    it('STE-1 lookupKeys success', async done => {
        const sdk = await EThree.initialize(fetchToken);
        const identity1 = 'virgiltestlookup1' + Date.now();
        const identity2 = 'virgiltestlookup2' + Date.now();
        const identity3 = 'virgiltestlookup3' + Date.now();
        const keypair1 = virgilCrypto.generateKeys();
        const keypair2 = virgilCrypto.generateKeys();
        const keypair3 = virgilCrypto.generateKeys();

        await Promise.all([
            cardManager.publishCard({ identity: identity1, ...keypair1 }),
            cardManager.publishCard({ identity: identity2, ...keypair2 }),
            cardManager.publishCard({ identity: identity3, ...keypair3 }),
        ]);
        const publicKeys = await sdk.lookupPublicKeys([identity1, identity2, identity3]);

        expect(publicKeys.length).toBe(3);
        expect(virgilCrypto.exportPublicKey(publicKeys[0]).toString('base64')).toEqual(
            virgilCrypto.exportPublicKey(keypair1.publicKey).toString('base64'),
        );
        expect(virgilCrypto.exportPublicKey(publicKeys[1]).toString('base64')).toEqual(
            virgilCrypto.exportPublicKey(keypair2.publicKey).toString('base64'),
        );
        expect(virgilCrypto.exportPublicKey(publicKeys[2]).toString('base64')).toEqual(
            virgilCrypto.exportPublicKey(keypair3.publicKey).toString('base64'),
        );
        done();
    });

    it('lookupKeys nonexistent identity', async done => {
        const sdk = await EThree.initialize(fetchToken);
        const identity1 = 'virgiltestlookupnonexist' + Date.now();
        const identity2 = 'virgiltestlookupnonexist' + Date.now();
        try {
            await sdk.lookupPublicKeys([identity1, identity2]);
        } catch (e) {
            expect(e.rejected().length).toBe(2);
            expect(e.rejected()[0]).toBeInstanceOf(LookupNotFoundError);
            expect(e.rejected()[1]).toBeInstanceOf(LookupNotFoundError);
            return done();
        }

        return done('should throw');
    });

    it('lookupKeys with error', async done => {
        const identity1 = 'virgiltestlookuperror1' + Date.now();
        const keypair1 = virgilCrypto.generateKeys();
        const fnStore = VirgilToolbox.prototype.getPublicKey;
        VirgilToolbox.prototype.getPublicKey = jest
            .fn()
            .mockResolvedValueOnce(keypair1.publicKey as VirgilPublicKey)
            .mockRejectedValueOnce(new Error('something happens'))
            .mockRejectedValueOnce(new LookupNotFoundError('not exists'));

        const provider = new CachingJwtProvider(fetchToken);

        const sdk = new EThree(identity, { provider });

        await Promise.all([cardManager.publishCard({ identity: identity1, ...keypair1 })]);

        try {
            const res = await sdk.lookupPublicKeys([identity1, 'not exists', 'with error']);
            expect(res).not.toBeDefined();
        } catch (e) {
            expect(e).toBeInstanceOf(LookupError);
            expect(e.resolved().length).toBe(1);
            expect(e.rejected().length).toBe(2);
            expect(e.rejected()[0]).toBeInstanceOf(Error);
            expect(e.rejected()[1]).toBeInstanceOf(LookupNotFoundError);
            VirgilToolbox.prototype.getPublicKey = fnStore;
            return done();
        }
        VirgilToolbox.prototype.getPublicKey = fnStore;
        done('should throw');
    });

    it('STE-2 lookupKeys with empty array of identities', async done => {
        const sdk = await EThree.initialize(fetchToken);
        try {
            await sdk.lookupPublicKeys([]);
        } catch (e) {
            expect(e).toBeInstanceOf(EmptyArrayError);
            return done();
        }
        done('should throw');
    });
});

describe('change password', () => {
    clear();
    it('should change password', async done => {
        const identity = 'virgiltest' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());
        try {
            const sdk = await EThree.initialize(fetchToken);
            await sdk.changePassword('old_password', 'new_password');
            await sdk.cleanup();
        } catch (e) {
            expect(e).not.toBeDefined();
            return done(e);
        }
        done();
    });
});

describe('backupPrivateKey', () => {
    it('success', async done => {
        const identity = 'virgiltestbackup1' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());

        const sdk = await EThree.initialize(fetchToken);
        const storage = await createSyncStorage(identity, 'secret_password');

        try {
            await storage.retrieveEntry(identity);
        } catch (e) {
            expect(e).toBeInstanceOf(Error);
        }

        try {
            await sdk.register();
            await sdk.backupPrivateKey('secret_password');
        } catch (e) {
            expect(e).not.toBeDefined();
        }
        const key = await storage.retrieveEntry(identity);
        expect(key).not.toBeNull();
        done();
    });

    it('fail', async done => {
        const identity = 'virgiltestbackup2' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());
        const sdk = await EThree.initialize(fetchToken);
        try {
            await sdk.backupPrivateKey('secret_pass');
        } catch (e) {
            expect(e).toBeInstanceOf(RegisterRequiredError);
            return done();
        }
        return done('should throw');
    });
});

describe('restorePrivateKey', () => {
    clear();
    it('has no private key', async done => {
        const pwd = 'secret_password';
        const identity = 'virgiltestrestore1' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());

        const sdk = await EThree.initialize(fetchToken);
        const storage = await createSyncStorage(identity, pwd);

        try {
            await storage.retrieveEntry(identity);
        } catch (e) {
            expect(e).toBeInstanceOf(Error);
        }
        let privateKey: IKeyEntry | null;
        try {
            await sdk.register();
            privateKey = await keyStorage.load(identity);
            await sdk.backupPrivateKey(pwd);
            await sdk.cleanup();
        } catch (e) {
            expect(e).not.toBeDefined();
        }
        const noPrivateKey = await keyStorage.load(identity);
        expect(noPrivateKey).toBeFalsy();
        await sdk.restorePrivateKey(pwd);
        const restoredPrivateKey = await keyStorage.load(identity);
        expect(restoredPrivateKey!.value.toString('base64')).toEqual(
            privateKey!.value.toString('base64'),
        );

        done();
    });

    it('has private key', async done => {
        const pwd = 'secret_password';
        const identity = 'virgiltestrestore1' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());

        const sdk = await EThree.initialize(fetchToken);
        const storage = await createSyncStorage(identity, pwd);

        try {
            await storage.retrieveEntry(identity);
        } catch (e) {
            expect(e).toBeInstanceOf(Error);
        }
        try {
            await sdk.register();
            await sdk.backupPrivateKey(pwd);
        } catch (e) {
            expect(e).not.toBeDefined();
        }

        const noPrivateKey = await keyStorage.load(identity);
        expect(noPrivateKey).toBeTruthy();
        try {
            await sdk.restorePrivateKey(pwd);
        } catch (e) {
            expect(e).toBeInstanceOf(PrivateKeyAlreadyExistsError);
            return done();
        }
        done('should throw');
    });
});

describe('encrypt and decrypt', () => {
    clear();

    it('STE-3 ', async done => {
        const identity1 = 'virgiltestencrypt1' + Date.now();
        const identity2 = 'virgiltestencrypt2' + Date.now();

        const fetchToken1 = () => Promise.resolve(generator.generateToken(identity1).toString());
        const fetchToken2 = () => Promise.resolve(generator.generateToken(identity2).toString());

        const [sdk1, sdk2] = await Promise.all([
            EThree.initialize(fetchToken1),
            EThree.initialize(fetchToken2),
        ]);

        await Promise.all([sdk1.register(), sdk2.register()]);
        const message = 'encrypt, decrypt, repeat';
        const sdk1PublicKeys = await sdk1.lookupPublicKeys([identity1]);
        const sdk2PublicKeys = await sdk2.lookupPublicKeys([identity2]);
        const encryptedMessage = await sdk1.encrypt(message, sdk2PublicKeys);
        try {
            await sdk2.decrypt(encryptedMessage);
        } catch (e) {
            expect(e).toBeInstanceOf(Error);
        }
        const decryptedMessage = await sdk2.decrypt(encryptedMessage, sdk1PublicKeys[0]);
        expect(decryptedMessage).toEqual(message);
        done();
    });

    it('STE-4 encrypt for empty public keys', async done => {
        const identity = 'virgiltestencrypt' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());

        const sdk = await EThree.initialize(fetchToken);
        await sdk.register();
        try {
            await sdk.encrypt('privet', []);
        } catch (e) {
            expect(e).toBeInstanceOf(EmptyArrayError);
            return done();
        }
        done('should throw');
    });

    it('STE-6 encrypt and decrypt without public keys', async done => {
        const identity = 'virgiltestencrypt' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());

        const sdk = await EThree.initialize(fetchToken);
        await sdk.register();
        const message = 'secret message';
        const encryptedMessage = await sdk.encrypt(message);
        const decryptedMessage = await sdk.decrypt(encryptedMessage);
        expect(decryptedMessage).toEqual(message);
        done();
    });

    it('STE-7 decrypt message without sign', async done => {
        const identity = 'virgiltestencrypt' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());

        const sdk = await EThree.initialize(fetchToken);
        await sdk.register();
        const receiverPublicKey = await sdk.lookupPublicKeys([identity]);
        const { publicKey: senderPublicKey } = virgilCrypto.generateKeys();
        const message = 'encrypted, but not signed :)';
        const encryptedMessage = await virgilCrypto
            .encrypt(message, receiverPublicKey)
            .toString('base64');
        try {
            await sdk.decrypt(encryptedMessage, senderPublicKey);
        } catch (e) {
            expect(e).toBeDefined();
            return done();
        }
        done('should throw');
    });

    it('STE-8 no decrypt/encrypt before bootstrap', async done => {
        const identity = 'virgiltestencrypt' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());

        await keyStorage.clear();
        const sdk = await EThree.initialize(fetchToken);
        try {
            await sdk.encrypt('message');
        } catch (e) {
            expect(e).toBeInstanceOf(RegisterRequiredError);
        }
        try {
            await sdk.decrypt('message');
        } catch (e) {
            expect(e).toBeInstanceOf(RegisterRequiredError);
        }
        done();
    });

    it('should return buffer', async done => {
        const identity = 'virgiltestencryptbuffer' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());

        const buf = new Buffer('123');

        const recipient = virgilCrypto.generateKeys();
        const sdk = await EThree.initialize(fetchToken);
        await sdk.register();
        const publicKey = (await sdk.lookupPublicKeys([identity]))[0];
        const encryptedMessage = await sdk.encrypt(buf, [recipient.publicKey]);
        expect(encryptedMessage).toBeInstanceOf(Buffer);

        const resp = await sdk.decrypt(encryptedMessage, publicKey);
        expect(resp).toBeInstanceOf(Buffer);
        done();
    });
});

describe('cleanup()', () => {
    it('local and remote key exists', async done => {
        const identity = 'virgiltestlogout' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());

        const sdk = await EThree.initialize(fetchToken);
        await sdk.register();
        const isDeleted = await sdk.cleanup();
        const privateKeyFromLocalStorage = await keyStorage.load(identity);
        const privateKeyFromKeyknox = await keyknoxStorage.load(identity);
        expect(privateKeyFromLocalStorage).toEqual(null);
        expect(privateKeyFromKeyknox).toEqual(null);
        expect(isDeleted).toBe(true);
        done();
    });

    it("local and remote key doesn't exists", async done => {
        const identity = 'virgiltestlogout' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());

        const sdk = await EThree.initialize(fetchToken);
        const isDeleted = await sdk.cleanup();
        const privateKeyFromLocalStorage = await keyStorage.load(identity);
        const privateKeyFromKeyknox = await keyknoxStorage.load(identity);
        expect(privateKeyFromLocalStorage).toEqual(null);
        expect(privateKeyFromKeyknox).toEqual(null);
        expect(isDeleted).toBe(true);
        done();
    });
});

describe('resetPrivateKeyBackup()', () => {
    it('reset backup private key', async done => {
        const pwd = 'secure_password';
        const identity = 'virgiltestlogout1' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());
        const cloudStorage = await createSyncStorage(identity, pwd);
        const sdk = await EThree.initialize(fetchToken);
        await sdk.register();
        await sdk.backupPrivateKey(pwd);

        try {
            await sdk.resetPrivateKeyBackup(pwd);
        } catch (e) {
            expect(e).not.toBeDefined();
        }

        try {
            await cloudStorage.retrieveEntry(identity);
        } catch (e) {
            expect(e).toBeTruthy();
        }

        return done();
    });

    it('reset backup private key when no backup', async done => {
        const pwd = 'secure_password';
        const identity = 'virgiltestlogout2' + Date.now();
        const fetchToken = () => Promise.resolve(generator.generateToken(identity).toString());
        const sdk = await EThree.initialize(fetchToken);
        await sdk.register();

        try {
            await sdk.resetPrivateKeyBackup(pwd);
        } catch (e) {
            expect(e).toBeInstanceOf(PrivateKeyNoBackupError);
            return done();
        }
        done('should throw');
    });
});
