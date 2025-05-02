'use client';

import { useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { LoaderIcon } from '@/components/icons';
import { signOutUser } from '../actions';

export default function SignOutPage() {
  useEffect(() => {
    const performSignOut = async () => {
      try {
        // First try client-side sign out
        await signOut({ redirect: false });
        
        // Then use our server action for complete sign out
        await signOutUser();
      } catch (error) {
        console.error('Error during sign out:', error);
        
        // If there's an error with the server action, try to redirect manually
        window.location.href = '/';
      }
    };
    
    performSignOut();
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="animate-spin text-primary mb-4">
        <LoaderIcon size={48} />
      </div>
      <h1 className="text-xl font-semibold">Signing you out...</h1>
    </div>
  );
} 