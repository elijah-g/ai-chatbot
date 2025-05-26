'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDownIcon } from './icons';
import { cn } from '@/lib/utils';

interface ToolResultProps {
  toolName: string;
  result: any;
  children?: React.ReactNode;
}

export function ToolResult({ toolName, result, children }: ToolResultProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const variants = {
    collapsed: {
      height: 0,
      opacity: 0,
      marginTop: 0,
      marginBottom: 0,
    },
    expanded: {
      height: 'auto',
      opacity: 1,
      marginTop: '0.5rem',
      marginBottom: '0.5rem',
    },
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-row gap-2 items-center">
        <div className="text-sm text-muted-foreground">
          Called <span className="font-mono font-medium">{toolName}</span>
        </div>
        <button
          type="button"
          className={cn(
            "cursor-pointer transition-transform duration-200",
            isExpanded && "rotate-180"
          )}
          onClick={() => {
            setIsExpanded(!isExpanded);
          }}
        >
          <ChevronDownIcon size={14} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="content"
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            variants={variants}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
            className="pl-4 border-l border-border"
          >
            {children || (
              <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
} 