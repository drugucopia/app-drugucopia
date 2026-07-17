'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Collapse — thin adapter over daisyUI `.collapse`.
 *
 * Uses native HTML `<details>` / `<summary>` for accessibility
 * and daisyUI styling for visual consistency.
 */

interface CollapseProps extends React.DetailsHTMLAttributes<HTMLDetailsElement> {
  open?: boolean;
  className?: string;
}

export const Collapse = React.forwardRef<HTMLDetailsElement, CollapseProps>(
  ({ className, open, children, ...props }, ref) => {
    return (
      <details
        ref={ref}
        open={open}
        className={cn('collapse collapse-arrow bg-base-100 border border-base-300', className)}
        {...props}
      >
        {children}
      </details>
    );
  }
);
Collapse.displayName = 'Collapse';

export interface CollapseTitleProps
  extends React.HTMLAttributes<HTMLElement> {
  className?: string;
}

export const CollapseTitle = React.forwardRef<HTMLElement, CollapseTitleProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <summary
        ref={ref}
        className={cn('collapse-title text-sm font-medium min-h-0 py-3.5 px-4 cursor-pointer list-none', className)}
        {...props}
      >
        {children}
      </summary>
    );
  }
);
CollapseTitle.displayName = 'CollapseTitle';

export interface CollapseContentProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export const CollapseContent = React.forwardRef<HTMLDivElement, CollapseContentProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('collapse-content', className)}
        {...props}
      >
        <div className="px-4 pb-4 pt-0 text-sm text-base-content/80">
          {children}
        </div>
      </div>
    );
  }
);
CollapseContent.displayName = 'CollapseContent';