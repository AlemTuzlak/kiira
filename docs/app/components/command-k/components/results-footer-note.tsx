import { useTranslation } from "react-i18next"

export const ResultsFooterNote = () => {
	const { t } = useTranslation()
	return (
		<span className="text-[var(--color-footer-text)] text-xs opacity-70">
			{t("p.search_by")}{" "}
			<span className="font-semibold">
				<a href="https://github.com/AlemTuzlak/kiira" target="_blank" rel="noopener noreferrer">
					Kiira
				</a>
			</span>
		</span>
	)
}
