// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"context"
	"time"
)

func (m *Mem) CreateReport(ctx context.Context, reporterID, targetID, reason string) (*Report, error) {
	reason, err := cleanReason(reason)
	if err != nil {
		return nil, err
	}
	if reporterID == targetID {
		return nil, ErrInvalid
	}
	target, err := m.UserByID(ctx, targetID)
	if err != nil {
		return nil, err
	}
	reporter, err := m.UserByID(ctx, reporterID)
	if err != nil {
		return nil, err
	}
	rep := &Report{
		ID: memID(), ReporterID: &reporterID, TargetUserID: &targetID,
		ReporterTag: reporter.Tag, TargetTag: target.Tag,
		Reason: reason, Status: "open", CreatedAt: time.Now(),
	}
	m.repMu.Lock()
	m.reports = append(m.reports, rep)
	m.repMu.Unlock()
	out := *rep
	return &out, nil
}

func (m *Mem) ListReports(_ context.Context, status string) ([]Report, error) {
	if !validReportStatus(status) {
		return nil, ErrInvalid
	}
	m.repMu.Lock()
	defer m.repMu.Unlock()
	var out []Report
	for _, r := range m.reports {
		if status == "" || r.Status == status {
			out = append(out, *r)
		}
	}
	return out, nil
}

func (m *Mem) ResolveReport(_ context.Context, id, note string) error {
	m.repMu.Lock()
	defer m.repMu.Unlock()
	for _, r := range m.reports {
		if r.ID == id {
			now := time.Now()
			r.Status, r.ResolvedAt = "resolved", &now
			if note != "" {
				r.ResolvedNote = &note
			}
			return nil
		}
	}
	return ErrNotFound
}
