import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { FEATURE_KEYS } from "../access-catalog";

export const MAX_LIMIT = 999;

export class FeatureAccessDto {
  @IsString()
  @IsIn(FEATURE_KEYS)
  feature!: string;

  @IsBoolean()
  view!: boolean;

  @IsBoolean()
  edit!: boolean;

  @IsBoolean()
  create!: boolean;

  @IsBoolean()
  remove!: boolean;
}

export class CompanyLimitsDto {
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  professionals!: number;

  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  admins!: number;
}

// Substitui os acessos e os limites da empresa de uma vez (PUT).
export class UpdateCompanyAccessDto {
  /** Uma entrada por funcionalidade; a que faltar fica sem acesso. */
  @IsArray()
  @ArrayMaxSize(FEATURE_KEYS.length)
  @ValidateNested({ each: true })
  @Type(() => FeatureAccessDto)
  features!: FeatureAccessDto[];

  @ValidateNested()
  @Type(() => CompanyLimitsDto)
  limits!: CompanyLimitsDto;
}
