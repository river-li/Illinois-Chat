import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '~/test-utils/renderWithProviders'
import NavigationSidebar from '../NavigationSidebar'

describe('NavigationSidebar', () => {
  it('lists NLIP as a first-level item beside Tools', () => {
    renderWithProviders(
      <NavigationSidebar
        course_name="CS101"
        isOpen
        onToggle={vi.fn()}
        activeLink="/CS101/tools"
        isCollapsed={false}
        onCollapseToggle={vi.fn()}
      />,
    )

    const tools = screen.getByRole('link', { name: /Tools/ })
    const nlip = screen.getByRole('link', { name: /^NLIP$/ })
    expect(tools).toHaveAttribute('href', '/CS101/tools')
    expect(nlip).toHaveAttribute('href', '/CS101/nlip')
  })
})
