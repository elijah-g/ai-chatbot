'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createUser, getUser } from '@/lib/db/queries';

import { signIn, auth } from './auth';

const authFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export interface LoginActionState {
  status: 'idle' | 'in_progress' | 'success' | 'failed' | 'invalid_data';
}

export const login = async (
  _: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get('email'),
      password: formData.get('password'),
    });

    await signIn('credentials', {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: 'success' };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 'invalid_data' };
    }

    return { status: 'failed' };
  }
};

export interface RegisterActionState {
  status:
    | 'idle'
    | 'in_progress'
    | 'success'
    | 'failed'
    | 'user_exists'
    | 'invalid_data';
}

export const register = async (
  _: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get('email'),
      password: formData.get('password'),
    });

    const [user] = await getUser(validatedData.email);

    if (user) {
      return { status: 'user_exists' } as RegisterActionState;
    }
    await createUser(validatedData.email, validatedData.password);
    await signIn('credentials', {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: 'success' };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 'invalid_data' };
    }

    return { status: 'failed' };
  }
};

/**
 * Sign out the user by:
 * 1. Getting the session
 * 2. Clearing all auth-related cookies
 * 3. Redirecting to the home page
 */
export async function signOutUser() {
  // Get current session
  const session = await auth();
  
  if (session) {
    // Clear all auth-related cookies
    const cookieStore = await cookies();
    
    // Clear standard NextAuth cookies
    cookieStore.delete('next-auth.session-token');
    cookieStore.delete('next-auth.callback-url');
    cookieStore.delete('next-auth.csrf-token');
    
    // Clear secure versions too
    cookieStore.delete('__Secure-next-auth.callback-url');
    cookieStore.delete('__Secure-next-auth.session-token');
    cookieStore.delete('__Secure-next-auth.csrf-token');
    cookieStore.delete('__Host-next-auth.csrf-token');
    
    // Redirect to home page
    redirect('/');
  }
  
  // If no session, just redirect to home
  redirect('/');
}
