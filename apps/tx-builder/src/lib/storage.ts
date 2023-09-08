import localforage from 'localforage'
import { BatchFile, TxWithMeta } from '../typings/models'
import { trackSafeAppEvent } from './analytics'
import { stringifyReplacer } from './checksum'

localforage.config({
  name: 'tx-builder',
  version: 1.0,
  storeName: 'batch_transactions',
  description: 'List of stored transactions in the Transaction Builder',
})

const saveBatch = async (batchFile: BatchFile): Promise<{ id: string; batchFile: BatchFile }> => {
  const id = uuidv4()
  try {
    await localforage.setItem(id, batchFile)

    trackSafeAppEvent('Saved batch', batchFile.transactions.length.toString())
  } catch (error) {
    console.error(error)
  }

  return {
    id,
    batchFile,
  }
}

const removeBatch = async (batchId: string): Promise<void> => {
  try {
    await localforage.removeItem(batchId)

    trackSafeAppEvent('Remove batch')
  } catch (error) {
    console.error(error)
  }
}

const updateBatch = async (batchId: string, batchFile: BatchFile): Promise<void> => {
  try {
    await localforage.setItem(batchId, batchFile)

    trackSafeAppEvent('Update batch')
  } catch (error) {
    console.error(error)
  }
}

const getBatch = async (batchId: string): Promise<BatchFile | null> => {
  try {
    return await localforage.getItem(batchId)
  } catch (error) {
    console.error(error)
  }

  return null
}

const getBatches = async () => {
  const batches: Record<string, BatchFile> = {}
  try {
    await localforage.iterate((batch: BatchFile, key: string) => {
      batches[key] = batch
    })
  } catch (error) {
    console.error(error)
  }
  return batches
}

const downloadObjectAsJson = (batchFile: BatchFile) => {
  const blobURL = URL.createObjectURL(
    new Blob([JSON.stringify(batchFile, stringifyReplacer)], { type: 'application/json' }),
  )

  // If Firefox or Safari open a new window to download the file
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1365502
  if (
    navigator.userAgent.includes('Firefox') ||
    (navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome'))
  ) {
    return window.open(blobURL)
  }

  const downloadAnchorNode = document.createElement('a')

  downloadAnchorNode.setAttribute('href', blobURL)
  downloadAnchorNode.setAttribute('download', batchFile.meta.name + '.json')
  document.body.appendChild(downloadAnchorNode)
  downloadAnchorNode.click()
  downloadAnchorNode.remove()
}

const downloadBatch = async (batchFile: BatchFile) => {
  downloadObjectAsJson(batchFile)

  trackSafeAppEvent('Download batch')
}

const isSingleBatchFile = (batchFile: any): batchFile is BatchFile => {
  return batchFile.meta && batchFile.transactions
}

const isTxWithMeta = (batchFile: any): batchFile is TxWithMeta => {
  return (
    batchFile.pubkey &&
    batchFile.withdrawal_credentials &&
    batchFile.signature &&
    batchFile.deposit_data_root
  )
}

const transactionMetaTemplate: {
  to: string
  value: string
  data: string
  contractMethod: {
    inputs: {
      internalType: string
      name: string
      type: string
    }[]
    name: string
    payable: boolean
  }
  contractInputsValues: object
} = {
  to: '0x00000000219ab540356cBB839Cbe05303d7705Fa',
  value: '32000000000000000000',
  data: '',
  contractMethod: {
    inputs: [
      { internalType: 'bytes', name: 'pubkey', type: 'bytes' },
      { internalType: 'bytes', name: 'withdrawal_credentials', type: 'bytes' },
      { internalType: 'bytes', name: 'signature', type: 'bytes' },
      { internalType: 'bytes32', name: 'deposit_data_root', type: 'bytes32' },
    ],
    name: 'deposit',
    payable: true,
  },
  contractInputsValues: {},
}

const importFile = async (file: File): Promise<BatchFile | undefined> => {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.readAsText(file)
    reader.onload = async () => {
      const batchFile: BatchFile | { data: Record<string, BatchFile> } = JSON.parse(
        reader.result as string,
      )

      if (isSingleBatchFile(batchFile)) {
        resolve(batchFile)

        trackSafeAppEvent('Import batch')
        return
      }

      if (
        Array.isArray(batchFile) &&
        batchFile.every(a => {
          console.log(a)
          return isTxWithMeta(a)
        })
      ) {
        const transactions = batchFile
          .map(
            ({ pubkey, withdrawal_credentials, signature, deposit_data_root, hidden, locked }) => {
              return {
                pubkey: `0x${pubkey}`,
                withdrawal_credentials: `0x${withdrawal_credentials}`,
                signature: `0x${signature}`,
                deposit_data_root: `0x${deposit_data_root}`,
                hidden,
                locked,
              }
            },
          )
          .map(values => {
            return {
              ...transactionMetaTemplate,
              contractInputsValues: values,
            }
          })
        resolve({
          version: '1.0.0',
          chainId: '5',
          createdAt: new Date().getTime(),
          meta: {
            name: 'Transactions Batch',
            description: '',
            txBuilderVersion: '1.14.1',
            createdFromSafeAddress: '0x4f3e63c1B60B88eEEc2BA7551C502b0a07D857Ed',
            createdFromOwnerAddress: '',
            checksum: '0xdd47b3aa6161df4e15737f90f5a2c59c70abeaabcd1a7ff795697edefcdbe85a',
          },
          transactions,
        })

        trackSafeAppEvent('Import batch')
        return
      }

      const data = batchFile.data
      await importBatches(data)
      resolve(undefined)
    }
  })
}

const importBatches = async (data: Record<string, BatchFile>) => {
  Object.entries(data).forEach(async ([batchId, batchFile]) => {
    try {
      await localforage.setItem(batchId, batchFile)
    } catch (error) {
      console.error(error)
    }
  })
}

const uuidv4 = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const StorageManager = {
  saveBatch,
  removeBatch,
  updateBatch,
  getBatch,
  getBatches,
  downloadBatch,
  importFile,
}

export default StorageManager
