import {IdentityCodeEnum, LanguageCodeEnum, NetworkTypeEnum} from "../yeying/api/common/code";
import {
    BlockAddress,
    IdentityApplicationExtend,
    IdentityMetadata,
    IdentityOrganizationExtend,
    IdentityPersonalExtend,
    IdentityServiceExtend,
    Mnemonic,
    SecurityAlgorithm
} from "../yeying/api/common/message";
import {constructIdentifier, Identity, IdentityTemplate} from "./model";
import {
    convertCipherTypeTo,
    decodeBase64,
    decrypt,
    deriveRawKeyFromPassword, encodeBase64,
    encrypt,
    fromDidToPublicKey,
    sign,
    verify
} from "../common/cipher";
import {computeAddress, defaultPath, HDNodeWallet, Wordlist, wordlists} from "ethers";
import {getCurrentUtcString} from "../common/date";

export function recoveryFromMnemonic(mnemonic: Mnemonic, networkType = NetworkTypeEnum.NETWORK_TYPE_YEYING) {
    const wallet = HDNodeWallet.fromPhrase(mnemonic.phrase, mnemonic.password, mnemonic.path, wordlists[mnemonic.locale])
    return buildBlockAddress(networkType, wallet, mnemonic.path)
}

export function createBlockAddress(networkType = NetworkTypeEnum.NETWORK_TYPE_YEYING, language: LanguageCodeEnum = LanguageCodeEnum.LANGUAGE_CODE_ZH_CH, password: string = "", path: string = defaultPath): BlockAddress {
    let wordlist: Wordlist
    switch (language) {
        case LanguageCodeEnum.LANGUAGE_CODE_ZH_CH:
            wordlist = wordlists['zh_cn']
        case LanguageCodeEnum.LANGUAGE_CODE_EN_US:
            wordlist = wordlists['en']
        default:
            wordlist = wordlists['zh_cn']
    }

    const wallet = HDNodeWallet.createRandom(password, path, wordlist)
    return buildBlockAddress(networkType, wallet, path)
}

export async function updateIdentity(password: string, template: IdentityTemplate, identity: Identity) {
    const newIdentity = structuredClone(identity)
    newIdentity.metadata.name = template.name
    newIdentity.metadata.description = template.description
    newIdentity.metadata.parent = template.parent
    newIdentity.metadata.code = template.code
    newIdentity.metadata.avatar = template.avatar
    newIdentity.extend = template.extend
    newIdentity.metadata.version = identity.metadata.version + 1
    newIdentity.metadata.checkpoint = getCurrentUtcString()

    const algorithm = template.extend.securityConfig?.algorithm
    if (algorithm === undefined) {
        throw new Error("Unknown algorithm")
    }

    const blockAddress = await decryptBlockAddress(identity.blockAddress, algorithm, password)
    newIdentity.signature = await signIdentity(blockAddress.privateKey, newIdentity)
    return newIdentity
}

export async function encryptBlockAddress(blockAddress: BlockAddress, algorithm: SecurityAlgorithm, password: string) {
    const algorithmName = convertCipherTypeTo(algorithm.type)
    const key = await deriveRawKeyFromPassword(algorithmName, password)
    const cipher = await encrypt(algorithmName, key, decodeBase64(algorithm.iv), BlockAddress.encode(blockAddress).finish())
    return encodeBase64(cipher)
}

export async function decryptBlockAddress(blockAddress: string, algorithm: SecurityAlgorithm, password: string) {
    const algorithmName = convertCipherTypeTo(algorithm.type)
    const key = await deriveRawKeyFromPassword(algorithmName, password)
    const plain = await decrypt(algorithmName, key, decodeBase64(algorithm.iv), decodeBase64(blockAddress))
    return BlockAddress.decode(new Uint8Array(plain))
}

export async function createIdentity(password: string, template: IdentityTemplate) {
    const blockAddress = createBlockAddress()
    const metadata = IdentityMetadata.create({
        network: NetworkTypeEnum.NETWORK_TYPE_UNKNOWN,
        version: 0,
        did: blockAddress.identifier,
        address: blockAddress.address,
        parent: template.parent,
        name: template.name,
        description: template.description,
        code: template.code,
        avatar: template.avatar,
        created: getCurrentUtcString(),
        checkpoint: getCurrentUtcString()
    })

    const algorithm = template.extend.securityConfig?.algorithm
    if (algorithm === undefined) {
        throw new Error("Unknown algorithm")
    }
    const cipher = await encryptBlockAddress(blockAddress, algorithm, password)
    const identity: Identity = {
        metadata: metadata,
        blockAddress: cipher,
        extend: template.extend,
        signature: "",
    }

    identity.signature = await signIdentity(blockAddress.privateKey, identity)
    return identity
}

export async function verifyIdentity(identity: Identity) {
    return await verify(fromDidToPublicKey(identity.metadata.did), serializeIdentity(identity), identity.signature)
}

export async function signIdentity(privateKey: string, identity: Identity) {
    return await sign(privateKey, serializeIdentity(identity))
}

function serializeIdentity(identity: Identity): Uint8Array {
    const binaryWriter = IdentityMetadata.encode(identity.metadata);
    binaryWriter.string(identity.blockAddress)
    switch (identity.metadata.code) {
        case IdentityCodeEnum.IDENTITY_CODE_SERVICE:
            IdentityServiceExtend.encode(<IdentityServiceExtend>identity.extend, binaryWriter)
            break
        case IdentityCodeEnum.IDENTITY_CODE_APPLICATION:
            IdentityApplicationExtend.encode(<IdentityApplicationExtend>identity.extend, binaryWriter)
            break
        case IdentityCodeEnum.IDENTITY_CODE_PERSONAL:
            IdentityPersonalExtend.encode(<IdentityPersonalExtend>identity.extend, binaryWriter)
            break
        case IdentityCodeEnum.IDENTITY_CODE_ORGANIZATION:
            IdentityOrganizationExtend.encode(<IdentityOrganizationExtend>identity.extend, binaryWriter)
            break
        default:
            throw new Error(`Not supported identity code=${identity.metadata.code}`)
    }
    return binaryWriter.finish()
}

function buildBlockAddress(networkType: NetworkTypeEnum, wallet: HDNodeWallet, path: string): BlockAddress {
    const blockAddress = BlockAddress.create({
        privateKey: wallet.privateKey,
        address: computeAddress(wallet.privateKey),
        publicKey: wallet.publicKey,
        identifier: constructIdentifier(networkType, wallet.publicKey)
    })

    let mnemonic = wallet.mnemonic
    if (mnemonic !== null) {
        return {
            ...blockAddress,
            mnemonic: {
                phrase: mnemonic.phrase,
                locale: mnemonic.wordlist.locale,
                path: path,
                password: mnemonic.password,
            }
        }
    }
    return blockAddress
}

