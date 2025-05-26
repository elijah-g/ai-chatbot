'use client';

import React from 'react';
import type { Session } from 'next-auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut } from 'next-auth/react'; // Assuming usage of next-auth

interface UserMenuProps {
  user: Session['user'];
}

export function UserMenu({ user }: UserMenuProps) {
  if (!user) {
    // Optionally render a login button or nothing
    return null; 
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="px-2">
          {/* Basic user display - enhance as needed */}
          <span>{user.name || user.email}</span>
          {/* You might add an avatar here: 
          <img src={user.image} alt="User avatar" className="w-6 h-6 rounded-full ml-2" /> 
          */}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent sideOffset={8} align="start" className="w-[180px]">
        <DropdownMenuItem className="flex-col items-start">
          <div className="text-xs font-medium">{user.name}</div>
          <div className="text-xs text-zinc-500">{user.email}</div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Add other menu items like Profile, Settings etc. if needed */}
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: '/' })} // Adjust callbackUrl as needed
          className="cursor-pointer"
        >
          Log Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 