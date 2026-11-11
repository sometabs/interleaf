import { screen, within } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'

type User = ReturnType<typeof userEvent.setup>

export function findPicker(label: string): Promise<HTMLElement> {
  return screen.findByRole('button', { name: (name) => name.startsWith(`${label}, `) })
}

export async function openPicker(user: User, label: string): Promise<HTMLElement> {
  await user.click(await findPicker(label))
  return screen.findByRole('dialog', { name: label })
}

export async function pickOption(user: User, label: string, name: string | RegExp): Promise<void> {
  const picker = within(await openPicker(user, label))
  await user.click(picker.queryByRole('option', { name }) ?? picker.getByRole('button', { name }))
}
