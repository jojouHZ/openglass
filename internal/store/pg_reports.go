// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"context"
)

const reportCols = `id, reporter_id, target_user_id, reporter_tag, target_tag, reason,
	status, created_at, resolved_at, resolved_note`

func scanReport(row interface{ Scan(...any) error }) (*Report, error) {
	var r Report
	err := row.Scan(&r.ID, &r.ReporterID, &r.TargetUserID, &r.ReporterTag, &r.TargetTag,
		&r.Reason, &r.Status, &r.CreatedAt, &r.ResolvedAt, &r.ResolvedNote)
	return &r, err
}

func (p *PG) CreateReport(ctx context.Context, reporterID, targetID, reason string) (*Report, error) {
	reason, err := cleanReason(reason)
	if err != nil {
		return nil, err
	}
	if reporterID == targetID {
		return nil, ErrInvalid
	}
	target, err := p.UserByID(ctx, targetID)
	if err != nil {
		return nil, err
	}
	reporter, err := p.UserByID(ctx, reporterID)
	if err != nil {
		return nil, err
	}
	return scanReport(p.pool.QueryRow(ctx,
		`INSERT INTO reports (reporter_id, target_user_id, reporter_tag, target_tag, reason)
		 VALUES ($1,$2,$3,$4,$5) RETURNING `+reportCols,
		reporterID, targetID, reporter.Tag, target.Tag, reason))
}

func (p *PG) ListReports(ctx context.Context, status string) ([]Report, error) {
	if !validReportStatus(status) {
		return nil, ErrInvalid
	}
	rows, err := p.pool.Query(ctx,
		`SELECT `+reportCols+` FROM reports
		 WHERE ($1 = '' OR status = $1) ORDER BY created_at, id`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Report
	for rows.Next() {
		r, err := scanReport(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

func (p *PG) ResolveReport(ctx context.Context, id, note string) error {
	tag, err := p.pool.Exec(ctx,
		`UPDATE reports SET status='resolved', resolved_at=now(), resolved_note=NULLIF($2,'')
		 WHERE id=$1`, id, note)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
