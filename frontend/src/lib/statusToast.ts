import { toast } from 'sonner'

interface StatusToastMessages<T> {
  id: string
  loading: string
  success: string | ((value: T) => string)
  error: string | ((error: unknown) => string)
}

export async function withStatusToast<T>(
  task: () => Promise<T>,
  messages: StatusToastMessages<T>,
): Promise<T> {
  toast.loading(messages.loading, { id: messages.id })
  try {
    const value = await task()
    const successMessage = typeof messages.success === 'function'
      ? messages.success(value)
      : messages.success
    toast.success(successMessage, { id: messages.id })
    return value
  } catch (error) {
    const errorMessage = typeof messages.error === 'function'
      ? messages.error(error)
      : messages.error
    toast.error(errorMessage, { id: messages.id })
    throw error
  }
}
